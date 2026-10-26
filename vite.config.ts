import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      // THROWAWAY FIXTURE BRANCH ONLY - never merge: the fixture deployment
      // swaps the real Supabase client for the mock in client.fixture.ts so
      // the unmodified MyBooks dialog can be reviewed without an account.
      "@/integrations/supabase/client": path.resolve(__dirname, "./src/integrations/supabase/client.fixture"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
