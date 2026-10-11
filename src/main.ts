import "./styles.css";
import { createReaderApp } from "./app";
import { dataRootFromBaseUrl } from "./data-root";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Reader root element is missing");
createReaderApp(root, { dataRoot: dataRootFromBaseUrl(import.meta.env.BASE_URL) });
