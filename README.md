# Performance Quest

Jogo de perguntas do ENEM para salas em tempo real. O projeto tem um frontend leve em Vite e uma API Node.js/Express com banco SQLite. As perguntas e respostas são processadas pelo backend; o gabarito não é enviado ao navegador.

## Estrutura

```text
performance_quest_site/
├── backend/       API, SQLite, testes e configuração Discloud
├── frontend/      interface Vite
├── .env.example   exemplo de ambiente local da API
└── README.md
```

## Requisitos

- Node.js 20 ou superior (22 é usado na configuração Discloud)
- npm
- Internet, pois as questões são consultadas pela API pública do ENEM

## Rodar localmente

Instale as dependências uma única vez:

```powershell
cd backend
npm install
cd ..\frontend
npm install
```

Crie `backend/.env` copiando `backend/.env.example`. Para desenvolvimento local, use:

```env
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
FRONTEND_URL=http://localhost:5173
HOST_PASSWORD=1234
DATABASE_PATH=src/data/banco.db
ENEM_API_URL=https://api.enem.dev/v1
REQUEST_BODY_LIMIT=30kb
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=300
```

`HOST_PASSWORD` é a senha numérica (até quatro dígitos) solicitada na rota `/#host`. Troque `1234` por uma senha sua antes de publicar.

Em dois terminais separados, inicie os serviços:

```powershell
# terminal 1
cd backend
npm run dev

# terminal 2
cd frontend
npm run dev
```

Abra o endereço informado pelo Vite, normalmente `http://localhost:5173`. A API fica em `http://localhost:3000`. O frontend já usa esse endereço quando `VITE_API_URL` não é definido.

## Produção

Os mesmos arquivos funcionam em desenvolvimento e produção; a diferença está somente no comando de início e nas variáveis de ambiente.

### API

No diretório `backend`, use:

```powershell
npm start
```

Defina no ambiente de produção:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
HOST_PASSWORD=1234
FRONTEND_URL=https://SEU-FRONTEND.example
DATABASE_PATH=src/data/banco.db
ENEM_API_URL=https://api.enem.dev/v1
REQUEST_BODY_LIMIT=30kb
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=300
```

`FRONTEND_URL` deve ser exatamente a URL pública do frontend, sem barra no final. Caso existam várias URLs autorizadas, configure o CORS no backend antes de publicar.

### Frontend

Crie `frontend/.env` a partir de `frontend/.env.example` e informe a URL pública da API:

```env
VITE_API_URL=https://SEU-BACKEND.example
```

Gere os arquivos estáticos:

```powershell
cd frontend
npm run build
```

Publique o conteúdo gerado em `frontend/dist` em um serviço de hospedagem estática. Sempre que `VITE_API_URL` mudar, execute o build de novo, pois essa variável é incorporada aos arquivos do frontend.

## Publicar o backend na Discloud

1. Ajuste `backend/discloud.config`: substitua `ID=SUBSTITUA_PELO_SEU_SUBDOMINIO` pelo subdomínio escolhido. A configuração já solicita `1536 MB` de RAM e inicia a API com `npm run start`.
2. Configure as variáveis de ambiente no painel da Discloud, principalmente `NODE_ENV`, `HOST_PASSWORD`, `FRONTEND_URL`, `DATABASE_PATH` e `ENEM_API_URL`. Não publique senhas reais em repositórios públicos.

   Para uma aplicação `TYPE=site`, use obrigatoriamente `HOST=0.0.0.0` e `PORT=8080`.
3. Envie o **conteúdo da pasta `backend`** para a aplicação Discloud. O arquivo `discloud.config` precisa ficar na raiz do envio.
4. Após a publicação, teste `https://SEU-SUBDOMINIO/api/health`. A resposta esperada contém `ok: true`.
5. Coloque essa URL em `frontend/.env` como `VITE_API_URL`, execute `npm run build` no frontend e publique `frontend/dist`.

O SQLite é salvo no caminho definido por `DATABASE_PATH`. Confirme no painel da Discloud se os arquivos da aplicação persistem após reinicializações/atualizações. Se a plataforma disponibilizar volume persistente, aponte `DATABASE_PATH` para esse volume; sem persistência, salas e histórico podem ser perdidos numa nova implantação.

## Banco e manutenção

- O banco é criado automaticamente na primeira execução.
- Em desenvolvimento, o arquivo padrão é `backend/src/data/banco.db`.
- Para zerar o histórico local, pare a API e apague apenas esse arquivo de banco. Isso remove todas as salas, jogadores e estatísticas.
- Não suba um banco com dados reais para um repositório público.

## Testes e verificações

```powershell
cd backend
npm test

cd ..\frontend
npm run build
```

Os testes cobrem segurança das respostas, prazo, duplicidade, uma simulação com 20 salas/10 participantes e uma carga de 120 requisições de leitura.

## Fluxo de uso

1. O host abre `/#host`, informa a senha e cria uma sala.
2. Escolhe um ou mais anos do ENEM; a API alterna as questões entre os anos selecionados e as embaralha.
3. Participantes criam o perfil e entram por código ou QR Code.
4. Ao iniciar, há cinco segundos de preparação. O host não responde perguntas.
5. Depois que todos os participantes respondem, a próxima pergunta abre automaticamente.
