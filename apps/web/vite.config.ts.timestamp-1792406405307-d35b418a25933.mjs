// vite.config.ts
import { fileURLToPath, URL } from "node:url";
import react from "file:///home/user/UbriSuS/node_modules/@vitejs/plugin-react/dist/index.mjs";
import { defineConfig } from "file:///home/user/UbriSuS/apps/web/node_modules/vite/dist/node/index.js";
var __vite_injected_original_import_meta_url = "file:///home/user/UbriSuS/apps/web/vite.config.ts";
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", __vite_injected_original_import_meta_url)),
      // Validações compartilhadas com a API (CPF, CNS, CNPJ, idade, senha).
      "@compartilhado": fileURLToPath(new URL("../api/src/compartilhado", __vite_injected_original_import_meta_url))
    }
  },
  // dayjs e seus idiomas no mesmo pré-empacotamento: os componentes de data usam a mesma instância (pt-BR).
  optimizeDeps: { include: ["dayjs", "dayjs/locale/pt-br", "dayjs/plugin/customParseFormat", "@mantine/dates"] },
  server: {
    port: 5173,
    host: true,
    proxy: { "/api": "http://localhost:3333" }
  },
  build: {
    chunkSizeWarningLimit: 2500,
    sourcemap: false
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS91c2VyL1VicmlTdVMvYXBwcy93ZWJcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL3VzZXIvVWJyaVN1Uy9hcHBzL3dlYi92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS91c2VyL1VicmlTdVMvYXBwcy93ZWIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBmaWxlVVJMVG9QYXRoLCBVUkwgfSBmcm9tICdub2RlOnVybCc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi9zcmMnLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICAgIC8vIFZhbGlkYVx1MDBFN1x1MDBGNWVzIGNvbXBhcnRpbGhhZGFzIGNvbSBhIEFQSSAoQ1BGLCBDTlMsIENOUEosIGlkYWRlLCBzZW5oYSkuXG4gICAgICAnQGNvbXBhcnRpbGhhZG8nOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4uL2FwaS9zcmMvY29tcGFydGlsaGFkbycsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgIH0sXG4gIH0sXG4gIC8vIGRheWpzIGUgc2V1cyBpZGlvbWFzIG5vIG1lc21vIHByXHUwMEU5LWVtcGFjb3RhbWVudG86IG9zIGNvbXBvbmVudGVzIGRlIGRhdGEgdXNhbSBhIG1lc21hIGluc3RcdTAwRTJuY2lhIChwdC1CUikuXG4gIG9wdGltaXplRGVwczogeyBpbmNsdWRlOiBbJ2RheWpzJywgJ2RheWpzL2xvY2FsZS9wdC1icicsICdkYXlqcy9wbHVnaW4vY3VzdG9tUGFyc2VGb3JtYXQnLCAnQG1hbnRpbmUvZGF0ZXMnXSB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTczLFxuICAgIGhvc3Q6IHRydWUsXG4gICAgcHJveHk6IHsgJy9hcGknOiAnaHR0cDovL2xvY2FsaG9zdDozMzMzJyB9LFxuICB9LFxuICBidWlsZDoge1xuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogMjUwMCxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQW1RLFNBQVMsZUFBZSxXQUFXO0FBQ3RTLE9BQU8sV0FBVztBQUNsQixTQUFTLG9CQUFvQjtBQUZpSSxJQUFNLDJDQUEyQztBQUkvTSxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxjQUFjLElBQUksSUFBSSxTQUFTLHdDQUFlLENBQUM7QUFBQTtBQUFBLE1BRXBELGtCQUFrQixjQUFjLElBQUksSUFBSSw0QkFBNEIsd0NBQWUsQ0FBQztBQUFBLElBQ3RGO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFFQSxjQUFjLEVBQUUsU0FBUyxDQUFDLFNBQVMsc0JBQXNCLGtDQUFrQyxnQkFBZ0IsRUFBRTtBQUFBLEVBQzdHLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE9BQU8sRUFBRSxRQUFRLHdCQUF3QjtBQUFBLEVBQzNDO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCx1QkFBdUI7QUFBQSxJQUN2QixXQUFXO0FBQUEsRUFDYjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
