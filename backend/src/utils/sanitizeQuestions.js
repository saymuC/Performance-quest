export function sanitizeQuestion(question) {
    const {
        correctAlternative,
        ...safeQuestion
    } = question;

    return safeQuestion;
}