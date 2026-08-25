const ENEM_API_URL = "https://api.enem.dev/v1";

export async function getQuestions(year) {
    const response = await fetch(
        `${ENEM_API_URL}/exams/${year}/questions`
    );

    if (!response.ok) {
        throw new Error("Esse caralho ta com erro filha da puta burro")
    };

    return await response.json();
};