import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "out");

const EXPORTS = [
  "runCollectJob",
  "runDownloadJob",
  "runScrapeJob",
  "parseCookieText",
  "parseCookieFile",
  "expandCookiesForX",
  "openShardxContext",
  "openCloakContext",
  "defaultCliProfileDir",
  "ensureShardxReady",
  "ensureCloakBinary",
  "clearShardxProfile",
  "getShardxCacheDir",
  "createHttpContext",
  "resolveTargetPath",
  "readLoggedInScreenName",
  "detectProfileTab",
  "pathsForSources",
  "collectMediaFromProfile",
  "sha256Buffer",
  "sha256FileSync",
  "downloadAll",
  "zipFolderToFile",
  "defaultStamp",
  "labelFromPath",
  "writeBytesStream",
  "upgradeImageUrl",
  "videoThumbUrl",
  "imageFetchCandidates",
  "pickBestVideoVariant",
  "walkMediaFromJson",
  "mediaIdentity",
  "preferMedia",
  "collapseMediaItems",
  "sanitizeName",
  "filenameFor",
  "itemIndexKeys",
  "createKnownMediaCheck",
  "openMediaDb",
  "defaultDbPath",
  "flushAllMediaDbs",
  "isEncryptedDbBuffer",
  "MediaDbLockedError",
  "DB_FILE_NAME",
  "LEGACY_INDEX_NAME",
  "LEGACY_MIGRATED_SUFFIX"
];

const reservedNames = [
  "^xaver$",
  "^require$",
  "^exports$",
  "^module$",
  "^__dirname$",
  "^__filename$",
  "^process$",
  "^Buffer$",
  "^Function$",
  "^globalThis$",
  ...EXPORTS.map((n) => `^${n}$`)
];

function options(kind) {
  const node = kind !== "renderer";
  return {
    compact: true,
    target: node ? "node" : "browser",
    controlFlowFlattening: node,
    controlFlowFlatteningThreshold: 0.65,
    deadCodeInjection: false,
    identifierNamesGenerator: "hexadecimal",
    ignoreImports: true,
    log: false,
    numbersToExpressions: node,
    renameGlobals: false,
    renameProperties: false,
    reservedNames,
    reservedStrings: ["xaver", "xaver-media", "xaver-proxy", "xaver-media://", "xaver-proxy://"],
    selfDefending: false,
    simplify: true,
    splitStrings: node,
    splitStringsChunkLength: 6,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.75,
    stringArrayEncoding: ["base64", "rc4"],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: node ? 2 : 1,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: "function",
    stringArrayThreshold: 0.8,
    transformObjectKeys: false,
    unicodeEscapeSequence: false
  };
}

function kindFor(file) {
  const rel = path.relative(outDir, file).replaceAll("\\", "/");
  if (rel.startsWith("renderer/")) return "renderer";
  if (rel.startsWith("preload/")) return "preload";
  if (rel.startsWith("src/")) return "engine";
  return "main";
}

function collect(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) collect(p, acc);
    else if (/\.(js|mjs)$/.test(ent.name) && ent.name !== "cli.js") acc.push(p);
  }
  return acc;
}

function bytes(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

const files = collect(outDir);
if (!files.length) {
  console.error("obfuscate: out/ is empty, run the build first");
  process.exit(1);
}

let before = 0;
let after = 0;

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  before += Buffer.byteLength(src);
  const result = JavaScriptObfuscator.obfuscate(src, options(kindFor(file)));
  const code = result.getObfuscatedCode();
  fs.writeFileSync(file, code);
  after += Buffer.byteLength(code);
  console.log(`  ${path.relative(outDir, file)}  ${bytes(Buffer.byteLength(src))} → ${bytes(Buffer.byteLength(code))}`);
}

console.log(`obfuscate done. ${files.length} files  ${bytes(before)} → ${bytes(after)}`);
