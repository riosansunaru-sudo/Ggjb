// JavaScript Translation Logic

function translateText(text, language) {
    const translations = {
        'en': {
            'hello': 'Hello',
            'world': 'World'
        },
        'es': {
            'hello': 'Hola',
            'world': 'Mundo'
        },
        // Add more languages here
    };

    return translations[language][text] || text;
}

// Example usage
console.log(translateText('hello', 'en')); // Output: Hello
console.log(translateText('world', 'es')); // Output: Mundo
