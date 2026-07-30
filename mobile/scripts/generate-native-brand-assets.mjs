import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(scriptDir, "..");
const repoRoot = resolve(mobileRoot, "..");
const iconSource = resolve(repoRoot, "tracker/public/dev10x_icon.png");
const logoSource = resolve(repoRoot, "tracker/public/dev10x_logo_white.png");
const defaultOutput = resolve(mobileRoot, "assets/dev10x-native");
const dark = "#090A0F";

const expectedHashes = new Map([
  [iconSource, "59731a4e0d08e514075af55efdf7c3f94084a583132a59efd72b67a42119af8a"],
  [logoSource, "950c1b1e091e06a16c43f31d5a13552fef8fab336e88552b5684b3645c798aec"],
]);

const outputDir = argument("--output-dir") ?? defaultOutput;
verifyCanonicalSources();
mkdirSync(outputDir, { recursive: true });

opaqueIcon(resolve(outputDir, "icon-ios.png"));
opaqueIcon(resolve(outputDir, "icon-android.png"));

convert([
  iconSource,
  "-trim",
  "+repage",
  "-resize",
  "676x676",
  "-gravity",
  "center",
  "-background",
  "none",
  "-extent",
  "1024x1024",
  "-strip",
  `PNG32:${resolve(outputDir, "adaptive-foreground.png")}`,
]);

convert([
  iconSource,
  "-trim",
  "+repage",
  "-resize",
  "286x286",
  "-channel",
  "RGB",
  "-fill",
  "white",
  "-colorize",
  "100",
  "+channel",
  "-gravity",
  "center",
  "-background",
  "none",
  "-extent",
  "432x432",
  "-strip",
  `PNG32:${resolve(outputDir, "adaptive-monochrome.png")}`,
]);

convert([
  "-size",
  "1284x2778",
  `xc:${dark}`,
  "-strip",
  `PNG32:${resolve(outputDir, "splash.png")}`,
]);

function opaqueIcon(output) {
  convert([
    "-size",
    "1024x1024",
    `xc:${dark}`,
    "(",
    iconSource,
    "-trim",
    "+repage",
    "-resize",
    "760x760",
    ")",
    "-gravity",
    "center",
    "-composite",
    "-alpha",
    "off",
    "-strip",
    `PNG24:${output}`,
  ]);
}

function convert(args) {
  execFileSync("convert", args, { stdio: "inherit" });
}

function verifyCanonicalSources() {
  for (const [path, expected] of expectedHashes) {
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (actual !== expected) {
      throw new Error(`Canonical Dev10x source changed: ${path}`);
    }
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return resolve(value);
}
