const ENEM_API_URL = "https://api.enem.dev/v1";

export class EnemApiUnavailableError extends Error {
    constructor() {
        super("A API do ENEM está indisponível.");
        this.name = "EnemApiUnavailableError";
    }
}

export async function getQuestions(year) {
    let response;

    try {
        response = await fetch(
            `${ENEM_API_URL}/exams/${year}/questions`
        );
    } catch {
        throw new EnemApiUnavailableError();
    }

    if (!response.ok) {
        throw new EnemApiUnavailableError();
    }

    return await response.json();
};
