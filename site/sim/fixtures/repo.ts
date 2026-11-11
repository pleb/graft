import type { Repo } from "../events.ts";

const repo: Repo = {
  name: "acme/notes-api",
  files: {
    "src/server.js":
      'import { createServer } from "node:http";\n\ncreateServer(handle).listen(3000);\n',
    "README.md": "# notes-api\n\nA small notes API.\n",
  },
};

export default repo;
