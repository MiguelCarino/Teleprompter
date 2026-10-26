// i18n — Teleprompter dictionaries (fleet convention, see Password/i18n.js).
// English source strings ARE the keys, so a missing entry falls back to
// English. Locale comes from carino-lang.js (window.CarinoLang.current);
// this script is deferred and loaded after it, so CarinoLang exists by
// DOMContentLoaded, and we re-apply on the fleet 'carino:langchange' event.

const SAMPLE_EN = 'Sample script.\n\nPaste your own text here, or open a text file from the settings. Words in [brackets] are cues for you, shown in red. Press [Play] to start scrolling and again to pause. This tool is [free] and [open source].';

const I18N = {
    es: {
        "More": "Más",
        'Late shift.': 'Turno nocturno.',
        'Good morning.': 'Buenos días.',
        'Good afternoon.': 'Buenas tardes.',
        'Good evening.': 'Buenas noches.',
        '☰ Settings': '☰ Ajustes',
        'Back to top': 'Volver al inicio',
        'Play': 'Reproducir',
        'Pause': 'Pausa',
        'Paste your script or open a file, then press Play and read.': 'Pega tu guion o abre un archivo, pulsa Reproducir y lee.',
        'Script': 'Guion',
        'Drop a text file here or': 'Suelta aquí un archivo de texto o',
        'browse': 'examina',
        'Or paste into the prompter': 'O pégalo en el teleprompter',
        'Reading': 'Lectura',
        'Speed': 'Velocidad',
        'Text size': 'Tamaño del texto',
        'Font': 'Fuente',
        'Reading marker': 'Marcador de lectura',
        'Off': 'Desactivado',
        'Top left': 'Arriba a la izquierda',
        'Top right': 'Arriba a la derecha',
        'Middle left': 'Centro a la izquierda',
        'Middle right': 'Centro a la derecha',
        'Mirror, for teleprompter glass': 'Espejo, para el cristal del teleprompter',
        'Runs in your browser. Nothing you add here is uploaded.': 'Funciona en tu navegador. Nada de lo que añades aquí se sube.',
        'Settings': 'Ajustes',
        'Script text': 'Texto del guion',
        [SAMPLE_EN]: 'Guion de ejemplo.\n\nPega aquí tu propio texto o abre un archivo de texto desde los ajustes. Las palabras entre [corchetes] son indicaciones para ti y se muestran en rojo. Pulsa [Reproducir] para empezar a desplazar y otra vez para pausar. Esta herramienta es [gratuita] y de [código abierto].',
    },
    'pt-BR': {
        "More": "Mais",
        'Late shift.': 'Turno da noite.',
        'Good morning.': 'Bom dia.',
        'Good afternoon.': 'Boa tarde.',
        'Good evening.': 'Boa noite.',
        '☰ Settings': '☰ Ajustes',
        'Back to top': 'Voltar ao início',
        'Play': 'Reproduzir',
        'Pause': 'Pausar',
        'Paste your script or open a file, then press Play and read.': 'Cole seu roteiro ou abra um arquivo, aperte Reproduzir e leia.',
        'Script': 'Roteiro',
        'Drop a text file here or': 'Solte aqui um arquivo de texto ou',
        'browse': 'procure',
        'Or paste into the prompter': 'Ou cole no teleprompter',
        'Reading': 'Leitura',
        'Speed': 'Velocidade',
        'Text size': 'Tamanho do texto',
        'Font': 'Fonte',
        'Reading marker': 'Marcador de leitura',
        'Off': 'Desligado',
        'Top left': 'Em cima à esquerda',
        'Top right': 'Em cima à direita',
        'Middle left': 'No meio à esquerda',
        'Middle right': 'No meio à direita',
        'Mirror, for teleprompter glass': 'Espelhar, para o vidro do teleprompter',
        'Runs in your browser. Nothing you add here is uploaded.': 'Roda no seu navegador. Nada do que você adiciona aqui é enviado.',
        'Settings': 'Ajustes',
        'Script text': 'Texto do roteiro',
        [SAMPLE_EN]: 'Roteiro de exemplo.\n\nCole aqui o seu texto ou abra um arquivo de texto nos ajustes. Palavras entre [colchetes] são deixas para você e aparecem em vermelho. Aperte [Reproduzir] para começar a rolar e de novo para pausar. Esta ferramenta é [gratuita] e de [código aberto].',
    },
    ja: {
        "More": "その他",
        'Late shift.': '遅番ですね。',
        'Good morning.': 'おはようございます。',
        'Good afternoon.': 'こんにちは。',
        'Good evening.': 'こんばんは。',
        '☰ Settings': '☰ 設定',
        'Back to top': '先頭に戻る',
        'Play': '再生',
        'Pause': '一時停止',
        'Paste your script or open a file, then press Play and read.': '原稿を貼り付けるかファイルを開き、再生を押して読みます。',
        'Script': '原稿',
        'Drop a text file here or': 'テキストファイルをここにドロップするか',
        'browse': 'ファイルを選択',
        'Or paste into the prompter': 'またはプロンプターに貼り付け',
        'Reading': '表示',
        'Speed': '速度',
        'Text size': '文字サイズ',
        'Font': 'フォント',
        'Reading marker': '読み位置マーカー',
        'Off': 'オフ',
        'Top left': '左上',
        'Top right': '右上',
        'Middle left': '中央左',
        'Middle right': '中央右',
        'Mirror, for teleprompter glass': '左右反転（プロンプター用ガラス向け）',
        'Runs in your browser. Nothing you add here is uploaded.': 'ブラウザ内で動作します。ここに追加したものはアップロードされません。',
        'Settings': '設定',
        'Script text': '原稿テキスト',
        [SAMPLE_EN]: 'サンプル原稿です。\n\nここに自分の原稿を貼り付けるか、設定からテキストファイルを開いてください。[角かっこ]で囲んだ語は自分向けの合図で、赤で表示されます。[再生]を押すとスクロールが始まり、もう一度押すと一時停止します。このツールは[無料]で[オープンソース]です。',
    },
    ru: {
        "More": "Ещё",
        'Late shift.': 'Поздняя смена.',
        'Good morning.': 'Доброе утро.',
        'Good afternoon.': 'Добрый день.',
        'Good evening.': 'Добрый вечер.',
        '☰ Settings': '☰ Настройки',
        'Back to top': 'В начало',
        'Play': 'Пуск',
        'Pause': 'Пауза',
        'Paste your script or open a file, then press Play and read.': 'Вставьте текст или откройте файл, нажмите «Пуск» и читайте.',
        'Script': 'Текст',
        'Drop a text file here or': 'Перетащите сюда текстовый файл или',
        'browse': 'выберите файл',
        'Or paste into the prompter': 'Или вставьте текст в суфлёр',
        'Reading': 'Чтение',
        'Speed': 'Скорость',
        'Text size': 'Размер текста',
        'Font': 'Шрифт',
        'Reading marker': 'Маркер чтения',
        'Off': 'Выкл.',
        'Top left': 'Вверху слева',
        'Top right': 'Вверху справа',
        'Middle left': 'Посередине слева',
        'Middle right': 'Посередине справа',
        'Mirror, for teleprompter glass': 'Зеркально, для стекла суфлёра',
        'Runs in your browser. Nothing you add here is uploaded.': 'Работает в вашем браузере. Ничего из добавленного сюда не загружается.',
        'Settings': 'Настройки',
        'Script text': 'Текст для чтения',
        [SAMPLE_EN]: 'Пример текста.\n\nВставьте сюда свой текст или откройте текстовый файл в настройках. Слова в [скобках] — подсказки для вас, они показаны красным. Нажмите [Пуск], чтобы начать прокрутку, и ещё раз, чтобы поставить паузу. Этот инструмент [бесплатный] и с [открытым кодом].',
    },
};

function currentFleetLang() { return (window.CarinoLang && window.CarinoLang.current) || 'en'; }

function t(key) {
    const dict = I18N[currentFleetLang()];
    return (dict && dict[key]) || key;
}

// Static markup: elements carrying data-i18n use their original English text
// as the key (captured on first pass, whitespace-normalized; locale switches
// stay reversible).
function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        if (!el.dataset.i18nKey) el.dataset.i18nKey = el.textContent.trim().replace(/\s+/g, ' ');
        el.textContent = t(el.dataset.i18nKey);
    });
}

// aria-labels, addressed explicitly.
function applyAttrI18n() {
    const rail = document.querySelector('.ws-rail');
    if (rail) rail.setAttribute('aria-label', t('Settings'));
    const tog = document.querySelector('[data-ws-toggle]');
    if (tog) tog.setAttribute('aria-label', t('Settings'));
    const tp = document.getElementById('teleprompter');
    if (tp) tp.setAttribute('aria-label', t('Script text'));
}

function applyI18n() {
    document.documentElement.lang = currentFleetLang();
    applyStaticI18n();
    applyAttrI18n();
    if (typeof repaintTp === 'function') repaintTp();   // the sample script, if it is still showing
}

document.addEventListener('DOMContentLoaded', applyI18n);
window.addEventListener('carino:langchange', applyI18n);
