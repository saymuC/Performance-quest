# Performance Quest

API para partidas de perguntas do ENEM. O servidor cria salas, sorteia questões, controla o tempo, recebe respostas com token, calcula pontuação no backend e mantém histórico para análise pedagógica.

## Recursos

- Salas com código aleatório e host autenticado.
- Tokens UUID por jogador e uma resposta por pergunta.
- Perguntas com prazo configurável (20 segundos por padrão).
- Gabarito protegido: nunca é enviado ao navegador.
- Pontuação entre 100 e 1000, proporcional ao tempo restante.
- Ranking por sala e estatísticas individuais/globais.
- Histórico no SQLite: eventos, tentativas, tempo de resposta, progresso, área e ano.
- CORS restrito, limite de JSON e rate limit por IP.

## Requisitos

- Node.js 20 ou superior
- npm

## Instalação

```bash
npm install
```

Crie `.env` na raiz do projeto a partir de `.env.example`:

```env
PORT=3000
FRONTEND_URL=http://localhost:5173
REQUEST_BODY_LIMIT=10kb
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=120
DATABASE_PATH=backend/src/data/banco.db
```

## Comandos

| Comando | Finalidade |
|---|---|
| `npm start` | Inicia a API |
| `npm run dev` | Inicia com nodemon |

A API fica disponível em `http://localhost:3000`.

## Fluxo da partida

1. O host cria uma sala e recebe `hostToken` e `playerToken`.
2. Os alunos entram usando o código da sala e recebem um `playerToken`.
3. O host inicia a partida com `x-host-token`.
4. Cada aluno busca a questão e responde com `x-player-token`.
5. O backend valida prazo, alternativa, duplicidade, correção e pontuação.
6. Ranking, estatísticas e registros históricos ficam disponíveis no banco/API.

## Rotas

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/health` | Estado da API |
| GET | `/api/questions` | Consulta questões sanitizadas |
| POST | `/api/games` | Cria sala |
| POST | `/api/games/:code/join` | Entra em sala |
| POST | `/api/games/:code/start` | Inicia partida |
| GET | `/api/games/:code/current` | Questão atual |
| POST | `/api/games/:code/answer` | Envia resposta |
| GET | `/api/games/:code/ranking` | Ranking da sala |
| GET | `/api/stats/:playerId` | Estatísticas individuais |
| GET | `/api/stats/overview` | Estatísticas da base |

## Exemplos de requisição

```bash
# Saúde
curl http://localhost:3000/api/health

# Criar uma sala
curl -X POST http://localhost:3000/api/games \
  -H "content-type: application/json" \
  -d "{\"hostNickname\":\"Ana\",\"year\":2023,\"quantity\":10,\"questionDurationSeconds\":20}"

# Entrar na sala
curl -X POST http://localhost:3000/api/games/ABC123/join \
  -H "content-type: application/json" \
  -d "{\"nickname\":\"Bruno\"}"

# Iniciar: substitua o token recebido
curl -X POST http://localhost:3000/api/games/ABC123/start \
  -H "x-host-token: SEU_HOST_TOKEN"

# Questão e resposta
curl http://localhost:3000/api/games/ABC123/current \
  -H "x-player-token: SEU_PLAYER_TOKEN"
curl -X POST http://localhost:3000/api/games/ABC123/answer \
  -H "content-type: application/json" \
  -H "x-player-token: SEU_PLAYER_TOKEN" \
  -d "{\"alternative\":\"A\"}"
```

## Códigos HTTP

| Código | Significado |
|---|---|
| 200/201 | Operação concluída |
| 400/401/403/422 | Requisição, token, origem ou dado inválido |
| 409 | Conflito esperado: sala já iniciada, prazo encerrado ou resposta duplicada |
| 429 | Limite de requisições atingido |
| 502 | Serviço externo de questões indisponível |

## Dados persistidos

Além de partidas, jogadores, perguntas e respostas, o banco guarda:

- `game_events`: criação, entrada e início de pergunta;
- `player_question_progress`: apresentação, primeiro acesso e resposta;
- `answer_attempts`: tentativas aceitas, duplicadas, inválidas ou expiradas;
- área, ano, acertos, erros, tempo e pontuação.
