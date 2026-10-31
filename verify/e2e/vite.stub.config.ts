// Dev-server config for the e2e harness: the real app, with network modules
// swapped for the scripted stubs in verify/stubs.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const stub = (p: string) => path.resolve(here, '../stubs', p);

export default defineConfig({
  root,
  plugins: [
    {
      name: 'e2e-stubs',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer) return null;
        const norm = source.replace(/\\/g, '/');
        if (norm === '@/integrations/supabase/client' || /(^|\/)integrations\/supabase\/client$/.test(norm)) return stub('supabase-client.ts');
        if (norm === '@/context/AuthContext' || /(^|\/)context\/AuthContext$/.test(norm)) return stub('auth-context.tsx');
        if (/^(\.\.\/|\.\/|@\/)api$/.test(norm)) return stub('api.ts');
        return null;
      },
    },
    react(),
  ],
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
});
