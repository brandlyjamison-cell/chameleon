export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "repo",
        "docs",
        "contracts",
        "skeleton",
        "engine",
        "db",
        "crypto",
        "brandmap",
        "ui",
        "config",
        "edge",
        "control",
        "pipeline",
        "infra",
        "ops",
        "testkit",
      ],
    ],
    "subject-case": [0],
    "header-max-length": [2, "always", 100],
  },
};
