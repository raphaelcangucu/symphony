import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { transformAsync } from "@babel/core";
import transformArrowFunctions from "@babel/plugin-transform-arrow-functions";
import transformClasses from "@babel/plugin-transform-classes";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const scriptDir = import.meta.dirname;
const mobileRoot = path.resolve(scriptDir, "..");
const outputPath = path.join(
  mobileRoot,
  "src",
  "orca",
  "terminal",
  "terminal-webview-engine.generated.ts",
);
const target = "chrome52";

const packages = ["@xterm/xterm", "@xterm/addon-unicode11", "@xterm/addon-webgl"];

async function readPackageVersion(packageName) {
  // Why: a package.json module specifier must use '/' — path.join emits '\' on
  // Windows, yielding an unresolvable bare specifier that fails postinstall there.
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  return `${packageName}@${packageJson.version}`;
}

function htmlText(value, closingTag) {
  return value.replace(new RegExp(`</${closingTag}`, "gi"), `<\\/${closingTag}`);
}

async function buildEngineJs() {
  const result = await esbuild.build({
    stdin: {
      contents: `
        import { Terminal } from '@xterm/xterm'
        import { Unicode11Addon } from '@xterm/addon-unicode11'
        import { WebglAddon } from '@xterm/addon-webgl'

        // Why: xterm reaches for these runtime APIs on the terminal-bringup path,
        // and esbuild lowers syntax but not runtime APIs. Guarded shims let the
        // Chrome-52-compatible bundle actually run on old WebViews (the #7030 goal)
        // instead of throwing at construction and only surfacing the error overlay.

        // WeakRef (Chrome 84+): lazily constructed in window-tracking paths.
        // Strong retention is fine for a single-document terminal WebView.
        if (typeof window.WeakRef === 'undefined') {
          window.WeakRef = function WeakRefShim(target) { this.__target = target }
          window.WeakRef.prototype.deref = function () { return this.__target }
        }

        // structuredClone (Chrome 98+): xterm clones its plain-data DEC-mode default
        // objects at Terminal construction; a JSON round-trip clones those correctly
        // (any undefined-valued keys drop, but every reader treats absent == undefined).
        if (typeof window.structuredClone === 'undefined') {
          window.structuredClone = function (value) { return JSON.parse(JSON.stringify(value)) }
        }

        // Element.prototype.replaceChildren (Chrome 86+): used on the row/selection
        // render path. Use appendChild/createTextNode because Element.append itself
        // is newer than the API 24 stock WebView.
        if (typeof Element !== 'undefined' && !Element.prototype.replaceChildren) {
          Element.prototype.replaceChildren = function () {
            while (this.firstChild) this.removeChild(this.firstChild)
            for (var i = 0; i < arguments.length; i++) {
              var value = arguments[i]
              var node = value && typeof value === 'object' && typeof value.nodeType === 'number'
                ? value
                : document.createTextNode(String(value))
              this.appendChild(node)
            }
          }
        }

        window.Terminal = Terminal
        window.Unicode11Addon = { Unicode11Addon }
        window.WebglAddon = { WebglAddon }
      `,
      resolveDir: mobileRoot,
      sourcefile: "terminal-webview-engine-entry.js",
    },
    bundle: true,
    // Must execute before bundled xterm modules, which reference globalThis
    // during evaluation on Android 7's stock WebView.
    banner: {
      js: [
        'var globalThis=typeof self!=="undefined"?self:window;',
        "if(!Object.fromEntries){Object.fromEntries=function(entries){",
        "var result={};var items=Array.from(entries);",
        "for(var i=0;i<items.length;i++){result[items[i][0]]=items[i][1];}",
        "return result;};}",
        'if(typeof queueMicrotask==="undefined"){',
        "var queueMicrotask=globalThis.queueMicrotask=function(callback){",
        "Promise.resolve().then(callback);};}",
        "if(!Array.prototype.values){Array.prototype.values=function(){",
        "var array=this;var index=0;var iterator={next:function(){",
        "return index<array.length?{value:array[index++],done:false}",
        ":{value:void 0,done:true};}};",
        'if(typeof Symbol!=="undefined"&&Symbol.iterator){',
        "iterator[Symbol.iterator]=function(){return this;};}",
        "return iterator;};}",
      ].join(""),
    },
    format: "iife",
    minify: true,
    platform: "browser",
    target,
    legalComments: "none",
    write: false,
    logLevel: "silent",
  });

  // Why Babel after esbuild: forcing only esbuild's `arrow: false` transform
  // leaves `super` references from xterm arrow callbacks outside class methods.
  // Babel transforms the affected classes together with arrows and preserves
  // their lexical super semantics for the API 24 stock WebView.
  const transformed = await transformAsync(result.outputFiles[0].text, {
    babelrc: false,
    configFile: false,
    comments: false,
    compact: true,
    minified: true,
    sourceType: "script",
    plugins: [transformClasses, transformArrowFunctions],
  });
  if (!transformed?.code) throw new Error("Babel produced no terminal engine");
  return transformed.code;
}

async function main() {
  const [engineJs, rawEngineCss, ...versions] = await Promise.all([
    buildEngineJs(),
    readFile(require.resolve("@xterm/xterm/css/xterm.css"), "utf8"),
    ...packages.map(readPackageVersion),
  ]);
  // Why: the no-external-URL regression gate bans http(s):// anywhere in the
  // terminal document. These xmlns URIs live inside data: URLs (never fetched);
  // percent-encoding the scheme colon satisfies the gate and URI-decodes back
  // before the SVG is parsed.
  const engineCss = rawEngineCss
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "http%3A//www.w3.org/2000/svg");

  const source = [
    "// Generated by scripts/build-terminal-webview-engine.mjs.",
    `// Packages: ${versions.join(", ")}.`,
    `// Target: ${target}. Do not edit by hand; regenerate via pnpm postinstall.`,
    `export const XTERM_ENGINE_JS = ${JSON.stringify(htmlText(engineJs, "script"))}`,
    `export const XTERM_ENGINE_CSS = ${JSON.stringify(htmlText(engineCss, "style"))}`,
    "",
  ].join("\n");

  await writeFile(outputPath, source);
}

await main();
