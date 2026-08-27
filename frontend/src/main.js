import "./style.css";
import "./overrides.css";
import "./controls.css";
import defaultProfile from "./assets/perfil_padrao.jpg";
import { request } from "./api.js";
import { clearSession, loadSession, saveSession } from "./session.js";

const app = document.querySelector("#app");
let session = loadSession();
let profileImage = session.profileImage || defaultProfile;
let lobbyRefresh;

app.innerHTML = `
  <main>
    <header>
      <button class="brand" data-action="profile"><i>Q</i>performance<br><b>quest</b></button>
      <span id="status">verificando API</span>
    </header>
    <section id="view"></section>
  </main>
  <aside id="toast" role="status"></aside>
`;

document.addEventListener("click", handleClick);
document.addEventListener("submit", handleSubmit);
route();
checkHealth();

function render(html) {
    clearInterval(lobbyRefresh);
    document.querySelector("#view").innerHTML = html;
}

function showProfile() {
    if (session.host) {
        session = {};
        clearSession();
    }
    profileImage = defaultProfile;
    render(`
      <section class="panel">
        <p class="tag">SEU PERFIL</p>
        <h1>Pronto para<br><em>jogar?</em></h1>
        <form id="profile-form">
          <img class="profile-photo" id="profile-preview" src="${profileImage}" alt="Foto de perfil">
          <label>Foto de perfil
            <input id="profile-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
          </label>
          <label>Seu nome<input name="nickname" required minlength="2" value="${escapeHtml(session.nickname || "")}"></label>
          <button class="btn lime wide">Pronto →</button>
        </form>
      </section>
    `);
    document.querySelector("#profile-file").addEventListener("change", selectImage);
}

function showJoin(prefilledCode = "") {
    render(`
      <section class="panel">
        <button class="back" data-action="profile">← Perfil</button>
        <p class="tag">ENTRAR NA SALA</p>
        <h1>Qual é o<br><em>código?</em></h1>
        <form id="join-form">
          <label>Código da sala<input class="code" name="code" required minlength="6" maxlength="6" value="${escapeHtml(prefilledCode)}" placeholder="ABC123"></label>
          <button class="btn lime wide">Entrar na sala →</button>
          <button type="button" class="btn wide" data-action="scan">Escanear QR code</button>
        </form>
      </section>
    `);
}

async function showLobby() {
    if (!session.code || !session.playerToken) return showJoin();
    try {
        const room = await request(`/api/games/${session.code}/ranking`);
        const playerList = room.players || [];
        const host = playerList.find((player) => player.isHost);
        render(`
          <section class="lobby">
            <p class="tag">${session.host ? "SALA DO HOST" : "AGUARDANDO O HOST INICIAR A PARTIDA"}</p>
            <img class="profile-photo" src="${session.profileImage || defaultProfile}" alt="Seu perfil">
            <h2>${escapeHtml(session.nickname)}</h2>
            ${session.host ? `<div class="codebox"><small>CÓDIGO DA SALA</small><strong>${escapeHtml(session.code)}</strong><button data-action="copy">copiar</button></div><button class="btn lime" data-action="start">Começar agora →</button>` : `<div class="spinner" aria-label="Aguardando"></div><p class="lead">Assim que o host iniciar, sua questão aparecerá aqui.</p>`}
            <section class="people"><h3>Pessoas na sala · ${playerList.length}</h3>
              ${playerList.map((player) => `<div class="person"><img src="${player.profileImage || defaultProfile}" alt=""><b>${escapeHtml(player.nickname)}</b>${player.isHost ? "<small>HOST</small>" : ""}</div>`).join("")}
            </section>
            <button class="back leave" data-action="leave">Sair da sala</button>
          </section>
        `);
        if (session.host) {
            const qrData = encodeURIComponent(`${location.origin}${location.pathname}?room=${session.code}`);
            document.querySelector(".people").insertAdjacentHTML(
                "beforebegin",
                `<img class="qr-code" src="https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${qrData}" alt="QR code da sala">`
            );
            document.querySelector(".leave").insertAdjacentHTML(
                "beforebegin",
                '<button class="back leave" data-action="close">Fechar sala</button>'
            );
        }
        lobbyRefresh = setInterval(showLobby, 3000);
        if (!session.host && room.status === "in_progress") showGame();
        return host;
    } catch (error) {
        notify(error.message);
        showJoin(session.pendingRoom || "");
        delete session.pendingRoom;
    }
}

async function showGame() {
    clearInterval(lobbyRefresh);
    try {
        const game = await request(`/api/games/${session.code}/current`, {
            headers: { "x-player-token": session.playerToken }
        });
        const question = game.question;
        render(`<section class="game"><p class="tag">QUESTÃO ${game.position} DE ${game.totalQuestions}</p><h1>${escapeHtml(question.title)}</h1><div class="answers">${question.alternatives.map((alt) => `<button data-action="answer" data-letter="${alt.letter}"><b>${alt.letter}</b><span>${escapeHtml(alt.text)}</span></button>`).join("")}</div></section>`);
    } catch (error) {
        notify(error.message);
        showLobby();
    }
}

async function handleClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action } = button.dataset;
    if (action === "profile") showProfile();
    if (action === "scan") scanQrCode();
    if (action === "copy") { await navigator.clipboard.writeText(session.code); notify("Código copiado."); }
    if (action === "start") {
        try {
            await request(`/api/games/${session.code}/start`, { method: "POST", headers: { "x-host-token": session.hostToken } });
            showGame();
        } catch (error) { notify(error.message); }
    }
    if (action === "leave") {
        try { await request(`/api/games/${session.code}/leave`, { method: "POST", headers: { "x-player-token": session.playerToken } }); } catch {}
        clearSession();
        session = {};
        showProfile();
    }
    if (action === "close") {
        try {
            await request(`/api/games/${session.code}/close`, { method: "POST", headers: { "x-host-token": session.hostToken } });
            clearSession();
            session = {};
            showProfile();
        } catch (error) { notify(error.message); }
    }
    if (action === "answer") {
        try {
            const result = await request(`/api/games/${session.code}/answer`, { method: "POST", headers: { "x-player-token": session.playerToken }, body: JSON.stringify({ alternative: button.dataset.letter }) });
            notify(result.correct ? `Muito bem! +${result.points} pontos.` : "Resposta registrada.");
        } catch (error) { notify(error.message); }
    }
}

async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const values = Object.fromEntries(new FormData(form));
    if (form.id === "host-login-form") {
        session = { hostPassword: values.password, host: true };
        saveSession(session);
        showCreateRoom();
        return;
    }
    if (form.id === "create-form") {
        try {
            const data = await request("/api/games", { method: "POST", headers: { "x-host-password": session.hostPassword || "" }, body: JSON.stringify({ hostNickname: values.hostNickname.trim(), year: Number(values.year), area: values.area || undefined, quantity: Number(values.quantity), questionDurationSeconds: Number(values.questionDurationSeconds) }) });
            session = { ...session, nickname: values.hostNickname.trim(), code: data.game.code, playerToken: data.host.playerToken, hostToken: data.host.hostToken, host: true };
            saveSession(session);
            showLobby();
        } catch (error) { notify(error.message); }
        return;
    }
    if (form.id === "profile-form") {
        try {
            await request("/api/games/validate-nickname", { method: "POST", body: JSON.stringify({ nickname: values.nickname.trim() }) });
            session = { ...session, nickname: values.nickname.trim(), profileImage };
            saveSession(session);
            showJoin();
        } catch (error) { notify(error.message); }
        return;
    }
    try {
        const code = values.code.trim().toUpperCase();
        const data = await request(`/api/games/${code}/join`, { method: "POST", body: JSON.stringify({ nickname: session.nickname, profileImage: session.profileImage }) });
        session = { ...session, code, playerToken: data.player.playerToken, host: false };
        saveSession(session);
        showLobby();
    } catch (error) { notify(error.message); }
}

async function selectImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return notify("Use PNG, JPG, WEBP ou GIF.");
    const source = await loadImage(file);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 160;
    const context = canvas.getContext("2d");
    const scale = Math.max(160 / source.width, 160 / source.height);
    context.drawImage(source, (160 - source.width * scale) / 2, (160 - source.height * scale) / 2, source.width * scale, source.height * scale);
    profileImage = canvas.toDataURL("image/jpeg", 0.78);
    document.querySelector("#profile-preview").src = profileImage;
}

async function scanQrCode() {
    if (!navigator.mediaDevices?.getUserMedia) return notify("Seu navegador não permite acesso à câmera.");
    render('<section class="panel"><p class="tag">ESCANEAR QR CODE</p><video id="qr-video" autoplay playsinline></video><button class="btn wide" data-action="profile">Cancelar</button></section>');
    const { BrowserQRCodeReader } = await import("@zxing/browser");
    const reader = new BrowserQRCodeReader();
    try {
        const result = await reader.decodeOnceFromVideoDevice(undefined, "qr-video");
        const rawValue = result.getText();
        const code = new URL(rawValue, location.href).searchParams.get("room") || rawValue;
        session.pendingRoom = code.trim().toUpperCase();
        showProfile();
    } catch {
        notify("Não foi possível ler o QR code. Tente novamente.");
        showJoin();
    }
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = reader.result; };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function route() {
    const room = new URLSearchParams(location.search).get("room");
    if (location.hash === "#host") return showHostLogin();
    if (room) {
        session.pendingRoom = room;
        return showProfile();
    }
    showProfile();
}

function showHostLogin() {
    render(`<section class="panel"><p class="tag">ÁREA DO HOST</p><h1>Vamos criar<br><em>uma sala.</em></h1><form id="host-login-form"><label>Senha do host<input name="password" inputmode="numeric" pattern="[0-9]{1,4}" maxlength="4" required></label><button class="btn lime wide">Acessar criação →</button></form></section>`);
}

function showCreateRoom() {
    render(`<section class="panel"><p class="tag">NOVA PARTIDA</p><h1>Monte o<br><em>desafio.</em></h1><form id="create-form"><label>Nome do host<input name="hostNickname" required minlength="2" value="${escapeHtml(session.nickname || "")}"></label><label>Ano<select name="year"><option>2023</option><option>2022</option><option>2021</option></select></label><label>Área<select name="area"><option value="">Todas as áreas</option><option value="matemática">Matemática</option><option value="linguagens">Linguagens</option></select></label><label>Quantidade<select name="quantity"><option value="5">5</option><option value="10" selected>10</option><option value="20">20</option><option value="30">30</option></select></label><label>Tempo<select name="questionDurationSeconds"><option value="20">20 segundos</option><option value="30">30 segundos</option></select></label><button class="btn lime wide">Criar sala →</button></form></section>`);
}

async function checkHealth() {
    try { await request("/api/health"); const status = document.querySelector("#status"); status.textContent = "API online"; status.classList.add("on"); } catch { document.querySelector("#status").textContent = "API indisponível"; }
}
function notify(message) { const toast = document.querySelector("#toast"); toast.textContent = message; toast.className = "show"; clearTimeout(notify.timeout); notify.timeout = setTimeout(() => { toast.className = ""; }, 3000); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
