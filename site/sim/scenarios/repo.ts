import type { Repo } from "../events.ts";

// `.claude/graft/` exists and is ignored, so no scenario asks the Graft folder's ignore question.
const repo: Repo = {
  name: "acme/notes-api",
  files: {
    ".gitignore": "node_modules/\n/.claude/graft/\n",
    "package.json":
      '{\n  "name": "notes-api",\n  "type": "module",\n  "scripts": {\n    "start": "node src/server.js",\n    "test": "node --test",\n    "lint": "eslint ."\n  },\n  "dependencies": {\n    "express": "^4.21.2"\n  }\n}\n',
    "src/app.js":
      'import express from "express";\nimport { notesRouter } from "./routes/notes.js";\n\nexport const app = express();\napp.use(express.json());\napp.use("/notes", notesRouter);\n',
    "src/config.js": "export const config = {\n  port: Number(process.env.PORT ?? 3000),\n};\n",
    "src/server.js":
      'import { app } from "./app.js";\nimport { config } from "./config.js";\n\napp.listen(config.port);\n',
    "README.md":
      "# notes-api\n\nA small notes API.\n\n## Configuration\n\n| Variable | Default |\n| -------- | ------- |\n| `PORT`   | `3000`  |\n",
  },
};

export default repo;
