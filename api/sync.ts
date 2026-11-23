// Função da Vercel: POST /api/sync
import { handleSync } from '../server/api.js';

export default {
  fetch(request: Request) {
    return handleSync(request, process.env);
  },
};
