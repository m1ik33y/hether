import fs from "fs";
import path from "path";

// Extensions this endpoint is allowed to serve, and how to serve them.
// `text: true` means read as utf8 (safe for js/css/svg); otherwise read
// as a raw Buffer (needed for binary assets like fonts/images).
const ASSET_TYPES = {
  ".js":    { contentType: "application/javascript; charset=utf-8", text: true },
  ".css":   { contentType: "text/css; charset=utf-8",                text: true },
  ".svg":   { contentType: "image/svg+xml",                          text: true },
  ".png":   { contentType: "image/png",                              text: false },
  ".jpg":   { contentType: "image/jpeg",                             text: false },
  ".jpeg":  { contentType: "image/jpeg",                             text: false },
  ".gif":   { contentType: "image/gif",                              text: false },
  ".webp":  { contentType: "image/webp",                             text: false },
  ".woff":  { contentType: "font/woff",                              text: false },
  ".woff2": { contentType: "font/woff2",                             text: false },
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

  // `type` only picks which base folder to read from now — the actual
  // folders can (and do) contain more than one kind of asset, e.g. the
  // css folder also holds svg background images referenced via
  // relative url(...) in the stylesheet.
  const folder = type === "js" ? "web.structure.jshether" : "web.structure.cshether";

  // `file` now carries the full nested path (e.g. "aBc.../dEf.../qahft.js"),
  // not just a bare filename — so we can't use path.basename() anymore,
  // it would throw away the folder structure. Instead, normalize + verify
  // the resolved path can't escape the base asset folder.
  const normalized = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, "");

  if (normalized.includes("..") || path.isAbsolute(normalized)) {
    return res.status(400).send("Invalid file");
  }

  const extension = path.extname(normalized).toLowerCase();
  const assetType = ASSET_TYPES[extension];

  if (!assetType) {
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

  const body = assetType.text
    ? fs.readFileSync(filePath, "utf8")
    : fs.readFileSync(filePath); // Buffer, for binary assets

  res.setHeader("Content-Type", assetType.contentType);
  return res.status(200).send(body);
}
