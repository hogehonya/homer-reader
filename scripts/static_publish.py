#!/usr/bin/env python3
"""Publish registered static sites without creating application containers."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
import urllib.request
import uuid

SCHEMA = "static-publication-v1"
STATE = Path(".static-publish")
SITE_RE = r"[a-z0-9][a-z0-9-]{0,62}"
REPO_RE = r"[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*"


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def relative(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("invalid relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(p in (".", "..") or p.startswith(".") for p in value.split("/")):
        raise ValueError("hidden, absolute and traversal paths are forbidden")
    return path


def configuration(path="static-publish.json"):
    config = read_json(path)
    if config.get("schema") != "static-site-v1":
        raise ValueError("invalid configuration schema")
    if not re.fullmatch(SITE_RE, config.get("site", "")):
        raise ValueError("invalid site ID")
    if not re.fullmatch(SITE_RE + r"\.honya\.dev", config.get("host", "")):
        raise ValueError("invalid site hostname")
    if not re.fullmatch(REPO_RE, config.get("repo", "")):
        raise ValueError("invalid repository")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", config.get("branch", "")):
        raise ValueError("invalid branch")
    files = config.get("files")
    if not isinstance(files, dict) or "index.html" not in files:
        raise ValueError("explicit files mapping with index.html is required")
    for target, source in files.items():
        relative(target)
        relative(source)
        if target == "publication.json":
            raise ValueError("publication.json is reserved")
    return config


def identity(config, env):
    if env.get("CI") != "woodpecker" or env.get("CI_PIPELINE_EVENT") not in ("push", "manual"):
        raise ValueError("publishing requires push/manual Woodpecker CI")
    if env.get("CI_REPO") != config["repo"] or env.get("CI_COMMIT_BRANCH") != config["branch"]:
        raise ValueError("CI repository or branch mismatch")
    required = {"CI_REPO_REMOTE_ID": r"[1-9][0-9]*", "CI_PIPELINE_NUMBER": r"[1-9][0-9]*",
                "CI_COMMIT_SHA": r"[0-9a-f]{40}|[0-9a-f]{64}",
                "CI_PIPELINE_CREATED": r"[1-9][0-9]{8,10}",
                "CI_PIPELINE_URL": r"https://ci\.honya\.dev/repos/[0-9]+/pipeline/[0-9]+"}
    for key, pattern in required.items():
        if not re.fullmatch(pattern, env.get(key, "")):
            raise ValueError("invalid " + key)
    number = int(env["CI_PIPELINE_NUMBER"])
    if env["CI_PIPELINE_URL"].rsplit("/", 1)[1] != str(number):
        raise ValueError("pipeline number mismatch")
    created = datetime.fromtimestamp(int(env["CI_PIPELINE_CREATED"]), timezone.utc)
    return {"schema": SCHEMA, "site": config["site"], "url": "https://" + config["host"],
            "repo": config["repo"], "repo_id": env["CI_REPO_REMOTE_ID"],
            "release": "r" + env["CI_REPO_REMOTE_ID"] + "-b" + str(number),
            "commit": env["CI_COMMIT_SHA"], "pipeline": env["CI_PIPELINE_URL"],
            "pipeline_number": number, "created_at": created.isoformat(),
            "created_at_jst": created.astimezone(timezone(timedelta(hours=9))).isoformat()}


def regular_tree(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("expected regular directory: " + str(root))
    for item in root.rglob("*"):
        if item.is_symlink() or not (item.is_file() or item.is_dir()):
            raise ValueError("symlinks and special files are forbidden")


def hashes(root):
    regular_tree(root)
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(Path(root).rglob("*")) if p.is_file() and p.relative_to(root).as_posix() != "publication.json"}


def stage(config, env, base=Path.cwd(), state=STATE):
    value = identity(config, env)
    base = Path(base).resolve()
    state = Path(state)
    if state.is_symlink():
        raise ValueError("state directory is a symlink")
    state.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=state, prefix="prepare-") as temp:
        payload = Path(temp)
        for target, source in config["files"].items():
            src = base / relative(source)
            if not src.resolve().is_relative_to(base):
                raise ValueError("source escapes repository")
            if any(p.is_symlink() for p in [src, *src.parents] if p != base.parent):
                raise ValueError("source symlink rejected")
            dst = payload / relative(target)
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.is_dir():
                regular_tree(src)
                for item in src.rglob("*"):
                    relative(str(item.relative_to(src)))
                shutil.copytree(src, dst)
            elif src.is_file():
                shutil.copyfile(src, dst)
            else:
                raise ValueError("source missing: " + source)
        if not (payload / "index.html").is_file():
            raise ValueError("index.html must be a file")
        value["files"] = hashes(payload)
        if "publication.json" in value["files"] or (payload / "publication.json").exists():
            raise ValueError("reserved publication metadata in source")
        write_json(payload / "publication.json", value)
        destination = state / "payload"
        if destination.exists():
            if read_json(destination / "publication.json") != value or hashes(destination) != value["files"]:
                raise ValueError("different prepared payload already exists")
        else:
            payload.rename(destination)
    return value


@contextmanager
def site_lock(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("site mount must be an existing regular directory")
    path = root / ".publish.lock"
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def install(root, payload, value):
    """Keep immutable releases and replace only the site's current symlink."""
    root, payload = Path(root), Path(payload)
    if not re.fullmatch(r"r[1-9][0-9]*-b[1-9][0-9]*|bootstrap-[a-z0-9-]+", value["release"]):
        raise ValueError("invalid release ID")
    if hashes(payload) != value["files"] or read_json(payload / "publication.json") != value:
        raise ValueError("payload hash or metadata mismatch")
    with site_lock(root):
        releases = root / "releases"
        if releases.is_symlink():
            raise ValueError("release directory symlink rejected")
        releases.mkdir(exist_ok=True)
        current = root / "current"
        if current.is_symlink():
            previous_path = current.resolve(strict=True)
            if previous_path.parent != releases.resolve():
                raise ValueError("current link escapes release directory")
            previous = read_json(previous_path / "publication.json")
            same_repo = previous["repo"] == value["repo"]
            repo_id = value.get("repo_id")
            transferred_repo = (
                isinstance(repo_id, str)
                and re.fullmatch(r"[1-9][0-9]*", repo_id) is not None
                and previous.get("repo_id") == repo_id
                and previous.get("url") == value.get("url")
            )
            if previous["site"] != value["site"] or not (same_repo or transferred_repo):
                raise ValueError("existing site identity mismatch")
            if previous["pipeline_number"] > value["pipeline_number"]:
                raise ValueError("older pipeline cannot replace current release")
        elif current.exists():
            raise ValueError("current must be a managed symlink")
        destination = releases / value["release"]
        if destination.is_symlink():
            raise ValueError("release symlink rejected")
        if destination.exists():
            if read_json(destination / "publication.json") != value or hashes(destination) != value["files"]:
                raise ValueError("release ID already exists with different content")
        else:
            with tempfile.TemporaryDirectory(dir=releases, prefix=".prepare-") as temp:
                copied = Path(temp) / "content"
                shutil.copytree(payload, copied)
                for item in [copied, *copied.rglob("*")]:
                    item.chmod(0o755 if item.is_dir() else 0o644)
                copied.rename(destination)
        link = root / (".current-" + uuid.uuid4().hex)
        link.symlink_to("releases/" + value["release"])
        os.replace(link, current)


def registered(config, registry):
    sites = read_json(registry)["sites"]
    matches = [s for s in sites if s["id"] == config["site"]]
    if len(matches) != 1 or any(matches[0].get(k) != config[k] for k in ("repo", "host")):
        raise ValueError("site is not registered for this repository and hostname")
    if matches[0].get("legacy"):
        raise ValueError("legacy snapshots are read-only")


def prepared(config, env, state=STATE):
    value = read_json(Path(state) / "payload/publication.json")
    if any(value.get(k) != v for k, v in identity(config, env).items()):
        raise ValueError("prepared payload belongs to another CI run")
    return value


def verify(value):
    with urllib.request.urlopen(value["url"] + "/publication.json", timeout=15) as response:
        served = json.load(response)
    if served != value:
        raise ValueError("served metadata does not match this CI run")
    with urllib.request.urlopen(value["url"] + "/", timeout=15) as response:
        if response.status != 200 or hashlib.sha256(response.read()).hexdigest() != value["files"]["index.html"]:
            raise ValueError("served HTML does not match publication")
    print("STATIC_VERIFIED: " + value["url"])
    print("STATIC_CREATED_JST: " + value["created_at_jst"])
    print("STATIC_PIPELINE: " + value["pipeline"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("init", "check-config", "prepare", "publish", "verify"))
    parser.add_argument("target", nargs="?")
    parser.add_argument("--repo")
    parser.add_argument("--site")
    parser.add_argument("--host")
    parser.add_argument("--branch", default="main")
    parser.add_argument("--file", action="append", default=[])
    parser.add_argument("--config", default="static-publish.json")
    parser.add_argument("--root", type=Path, default=Path("/publish"))
    parser.add_argument("--registry", type=Path, default=Path("/registry/sites.json"))
    args = parser.parse_args()
    try:
        if args.command == "init":
            initialize(args)
            return
        config = configuration(args.config)
        if args.command == "prepare":
            stage(config, os.environ)
        elif args.command == "publish":
            registered(config, args.registry)
            value = prepared(config, os.environ)
            install(args.root, STATE / "payload", value)
        elif args.command == "verify":
            verify(prepared(config, os.environ))
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, "STATIC_ERROR: " + str(error) + "\n")


def pipeline(config):
    branch = json.dumps(config["branch"])
    return '''when:
  - event: pull_request
  - event: [push, manual]
    branch: BRANCH

clone:
  git:
    image: woodpeckerci/plugin-git

steps:
  - name: validate-static
    image: python:3.13-alpine
    commands:
      - python3 -m py_compile scripts/static_publish.py
      - python3 scripts/static_publish.py check-config

  - name: publish-static
    image: python:3.13-alpine
    when:
      - event: [push, manual]
        branch: BRANCH
    volumes:
      - /mnt/8TBHDD/SERVICES/web-publish/sites/SITE:/publish
      - /home/honya/web-publish:/registry:ro
    commands:
      - python3 scripts/static_publish.py prepare
      - python3 scripts/static_publish.py publish
      - python3 scripts/static_publish.py verify
'''.replace("BRANCH", branch).replace("SITE", config["site"])


def initialize(args):
    if not args.target or not args.repo or not args.site or not args.host or not args.file:
        raise ValueError("init requires target, --repo, --site, --host and explicit --file destination=source")
    mapping = {}
    for value in args.file:
        key, sep, source = value.partition("=")
        if not sep or key in mapping:
            raise ValueError("invalid or duplicate file mapping")
        mapping[key] = source
    config = {"schema": "static-site-v1", "repo": args.repo, "site": args.site,
              "host": args.host, "branch": args.branch, "files": mapping}
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / "config.json"
        write_json(path, config)
        configuration(path)
    target = Path(args.target).resolve()
    if not target.is_dir() or any(target.glob(".woodpecker*")):
        raise ValueError("target must exist without CI; integrate generated steps into existing quality gates")
    files = {"static-publish.json": json.dumps(config, indent=2) + "\n",
             "scripts/static_publish.py": Path(__file__).read_text(), ".woodpecker.yml": pipeline(config)}
    for name in files:
        path = target / name
        if path.exists() or path.is_symlink() or any(p.is_symlink() for p in path.parents):
            raise ValueError("refusing to overwrite existing content or symlink")
    for name, content in files.items():
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x") as handle:
            handle.write(content)
    print("STATIC_CI_GENERATED: " + str(target))


if __name__ == "__main__":
    main()
