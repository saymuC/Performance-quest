const storageKey = "performance-quest-session";

export function loadSession() {
    try {
        return JSON.parse(localStorage.getItem(storageKey)) || {};
    } catch {
        return {};
    }
}

export function saveSession(session) {
    localStorage.setItem(storageKey, JSON.stringify(session));
}

export function clearSession() {
    localStorage.removeItem(storageKey);
}
