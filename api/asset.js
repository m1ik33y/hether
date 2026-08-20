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

  const folder = type === "js" ? "js" : "css";
  const extension = type === "js" ? ".js" : ".css";

  const safeFile = path.basename(file);

  if (!safeFile.endsWith(extension)) {
    return res.status(404).send("Not found");
  }

  const filePath = path.join(
    process.cwd(),
    folder,
    safeFile
  );

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