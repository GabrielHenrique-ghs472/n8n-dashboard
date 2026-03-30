import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { createSupabaseClient } from "./modules/supabaseClient.js";
import { createRoutes } from "./routes.js";

const app = express();
const supabase = createSupabaseClient(config);

app.use(express.json({ limit: "8mb" }));
app.use("/api", createRoutes({ config, supabase }));

const publicDir = path.resolve(process.cwd(), "public");
app.use(express.static(publicDir));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(config.port, () => {
  console.log(`Lara editor rodando em http://localhost:${config.port}`);
});
