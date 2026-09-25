import fs from "fs";
import path from "path";

export default function handler(req, res) {
  const file = req.query.file;
  const type = req.query.type;

  if (!file || Array.isArray(file)) {
    return res.status(400).send("Missing file");
  }

  if (type !== "js" && type !== "css") {
    return res.status(400).send("Invalid type");
  }

  const folder = type === "js" ? "web.structure.jshether" : "web.structure.cshether";
  const extension = type === "js" ? ".js" : ".css";

  // `file` now carries the full nested path (e.g. "aBc.../dEf.../qahft.js"),
  // not just a bare filename — so we can't use path.basename() anymore,
  // it would throw away the folder structure. Instead, normalize + verify
  // the resolved path can't escape the base asset folder.
  const normalized = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, "");

  if (normalized.includes("..") || path.isAbsolute(normalized)) {
    return res.status(400).send("Invalid file");
  }

  if (!normalized.endsWith(extension)) {
    return res.status(404).send("Not found");
  }

  const baseDir = path.join(process.cwd(), folder);
  const filePath = path.join(baseDir, normalized);

  // Belt-and-suspenders: confirm the resolved path still lives inside baseDir.
  if (!filePath.startsWith(baseDir + path.sep)) {
    return res.status(400).send("Invalid file");
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Not found");
  }

  // Directly opened as a page → blank document.
  if (
    req.headers["sec-fetch-dest"] === "document" ||
    req.headers["sec-fetch-mode"] === "navigate"
  ) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send("");
  }

  const code = fs.readFileSync(filePath, "utf8");

  if (type === "js") {
    res.setHeader(
      "Content-Type",
      "application/javascript; charset=utf-8"
    );
  } else {
    res.setHeader(
      "Content-Type",
      "text/css; charset=utf-8"
    );
  }

  return res.status(200).send(code);
}