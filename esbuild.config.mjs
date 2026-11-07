import esbuild from "esbuild";
// the plugin: one CommonJS file, `siyuan` is provided by the app
await esbuild.build({
	entryPoints: ["src/index.ts"], bundle: true, format: "cjs", target: "es2020", outfile: "dist/index.js",
	external: ["siyuan"], minify: false, logLevel: "info",
});
// the pure logic as an ES module for the unit tests
await esbuild.build({ entryPoints: ["src/stick.ts"], bundle: true, format: "esm", outfile: "build/stick.mjs", logLevel: "warning" });
