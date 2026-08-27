import "../config/environment.js";

export class EnemApiUnavailableError extends Error {
    constructor() {
        super("A API do ENEM está indisponível.");
        this.name = "EnemApiUnavailableError";
    }
}

export class EnemApiInvalidResponseError extends Error {
    constructor() {
        super("A API do ENEM retornou um formato inválido.");
        this.name = "EnemApiInvalidResponseError";
    }
}

function isValidQuestion(question) {
    return (
        question &&
        typeof question === "object" &&
        typeof question.title === "string" &&
        typeof question.discipline === "string" &&
        typeof question.correctAlternative === "string" &&
        (
            question.language === undefined ||
            question.language === null ||
            typeof question.language === "string"
        ) &&
        Array.isArray(question.alternatives) &&
        question.alternatives.every((alternative) =>
            alternative &&
            typeof alternative === "object" &&
            typeof alternative.letter === "string" &&
            typeof alternative.text === "string" &&
            typeof alternative.isCorrect === "boolean"
        )
    );
}

function isValidQuestionsResponse(data) {
    return (
        data &&
        typeof data === "object" &&
        Array.isArray(data.questions) &&
        data.questions.every(isValidQuestion)
    );
}

export async function getQuestions(year) {
    const enemApiUrl = process.env.ENEM_API_URL;

    if (!enemApiUrl) {
        throw new EnemApiUnavailableError();
    }

    let response;

    try {
        response = await fetch(
            `${enemApiUrl}/exams/${year}/questions`
        );
    } catch {
        throw new EnemApiUnavailableError();
    }

    if (!response.ok) {
        throw new EnemApiUnavailableError();
    }

    let data;

    try {
        data = await response.json();
    } catch {
        throw new EnemApiInvalidResponseError();
    }

    if (!isValidQuestionsResponse(data)) {
        throw new EnemApiInvalidResponseError();
    }

    return data;
};
