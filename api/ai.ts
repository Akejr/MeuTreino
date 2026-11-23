// Função da Vercel: POST /api/ai
import { handleAI } from '../server/api.js';

export default {
  fetch(request: Request) {
    return handleAI(request, process.env);
  },
};
