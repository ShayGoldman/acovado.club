const { resolve } = require("node:path");
const prettier = require("eslint-config-prettier");
const turbo = require("eslint-config-turbo");
const onlyWarn = require("eslint-plugin-only-warn");
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const { FlatCompat } = require("@eslint/eslintrc");

const project = resolve(process.cwd(), "tsconfig.json");

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

module.exports = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...compat.extends(turbo.extends[0]),
  prettier,
  {
    plugins: {
      "only-warn": onlyWarn,
    },
    settings: {
      "import/resolver": {
        typescript: {
          project,
        },
      },
    },
    ignores: [
      // Ignore dotfiles
      ".*.js",
      "node_modules",
      "**/node_modules",
      "dist/",
      "**/dist"
    ],

    files: ["*.ts", "*.js"],
  },
);
