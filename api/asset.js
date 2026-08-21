import fs from "fs";
import path from "path";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

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
  const safeFile = path.basename(file);
  const actualExt = path.extname(safeFile).toLowerCase();

  const mime = MIME_TYPES[actualExt];
  if (!mime) {
    return res.status(404).send("Not found");
  }

  const filePath = path.join(process.cwd(), folder, safeFile);

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

  res.setHeader("Content-Type", mime);

  // Binary-safe read/send — text files still work, images do too
  if (mime.startsWith("text/") || mime === "application/javascript") {
    return res.status(200).send(fs.readFileSync(filePath, "utf8"));
  }
  return res.status(200).send(fs.readFileSync(filePath));
}
