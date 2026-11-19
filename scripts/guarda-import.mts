// Importado por cada scripts/testar-*.mts: carrega .env.test.local e recusa rodar se algo apontar
// para a produção.
import { prepararAmbienteDeTeste } from "./guarda-producao";

prepararAmbienteDeTeste();
