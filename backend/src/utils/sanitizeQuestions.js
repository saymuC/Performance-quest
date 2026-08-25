export function sanitizeQuestion(question) {
    const {
        correctAlternative,
        alternatives = [],
        ...safeQuestion
    } = question;

    return {
        ...safeQuestion,
        alternatives: alternatives.map(({ isCorrect, ...safeAlternative }) => safeAlternative)
    };
}
