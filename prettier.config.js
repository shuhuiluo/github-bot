import prettierPluginSortImports from "@ianvs/prettier-plugin-sort-imports";

/** @type {import("prettier").Config} */
const config = {
  semi: true,
  trailingComma: "es5",
  singleQuote: false,
  printWidth: 80,
  tabWidth: 2,
  arrowParens: "avoid",
  plugins: [prettierPluginSortImports],
  importOrder: [
    "^node:",
    "",
    "<THIRD_PARTY_MODULES>",
    "^@towns-protocol/(.*)$",
    "^@/",
    "",
    "^[./]",
  ],
};

export default config;
