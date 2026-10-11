import "./styles.css";
import { createReaderApp } from "./app";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Reader root element is missing");
createReaderApp(root, { dataRoot: import.meta.env.BASE_URL });
