export function applyShakyTitles() {
    const shakyTitles = document.querySelectorAll("h1");

    shakyTitles.forEach(title => {
        if (title.dataset.shakyApplied === "true") return;

        const text = title.textContent?.trim() ?? "";
        title.textContent = "";

        const words = text.split(" ");

        words.forEach((word, wordIndex) => {
            const wordSpan = document.createElement("span");
            wordSpan.className = "shaky-word";

            for (let i = 0; i < word.length; i++) {
                const letterSpan = document.createElement("span");
                letterSpan.className = "shaky-letter";
                letterSpan.textContent = word[i];
                letterSpan.style.animationDelay =
                    `${(wordIndex * 0.1) + (i * 0.25)}s`;

                wordSpan.appendChild(letterSpan);
            }

            title.appendChild(wordSpan);

            if (wordIndex < words.length - 1) {
                title.appendChild(document.createTextNode(" "));
            }
        });

        title.dataset.shakyApplied = "true";
    });
}