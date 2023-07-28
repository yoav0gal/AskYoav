import {
    html,
    h,
    signal,
    computed,
    render,
    useSignal,
    useEffect,
    useRef,
} from "/index.js";

import { llama } from "/completion.js";

const session = signal({
    prompt: "This is a conversation between user and Yoav, a chatbot. respond in simple markdown.",
    template: "{{prompt}}\n\n{{history}}\n{{char}}:",
    historyTemplate: "{{name}}: {{message}}",
    transcript: [],
    type: "chat",
    char: "Yoav",
    user: "User",
});

const params = signal({
    n_predict: 400,
    temperature: 0.7,
    repeat_last_n: 256, // 0 = disable penalty, -1 = context size
    repeat_penalty: 1.18, // 1.0 = disabled
    top_k: 40, // <= 0 to use vocab size
    top_p: 0.5, // 1.0 = disabled
    tfs_z: 1.0, // 1.0 = disabled
    typical_p: 1.0, // 1.0 = disabled
    presence_penalty: 0.0, // 0.0 = disabled
    frequency_penalty: 0.0, // 0.0 = disabled
    mirostat: 0, // 0/1/2
    mirostat_tau: 5, // target entropy
    mirostat_eta: 0.1, // learning rate
});

const llamaStats = signal(null);
const controller = signal(null);

const generating = computed(() => controller.value == null);
const chatStarted = computed(() => session.value.transcript.length > 0);

const transcriptUpdate = (transcript) => {
    session.value = {
        ...session.value,
        transcript,
    };
};

// simple template replace
const template = (str, extraSettings) => {
    let settings = session.value;
    if (extraSettings) {
        settings = { ...settings, ...extraSettings };
    }
    return String(str).replaceAll(/\{\{(.*?)\}\}/g, (_, key) =>
        template(settings[key])
    );
};

// send message to server
const chat = async (msg) => {
    if (controller.value) {
        console.log("already running...");
        return;
    }
    controller.value = new AbortController();

    transcriptUpdate([...session.value.transcript, ["{{user}}", msg]]);

    const prompt = template(session.value.template, {
        message: msg,
        history: session.value.transcript
            .flatMap(([name, message]) =>
                template(session.value.historyTemplate, { name, message })
            )
            .join("\n"),
    });

    let currentMessage = "";
    const history = session.value.transcript;

    const llamaParams = {
        ...params.value,
        stop: ["</s>", template("{{char}}:"), template("{{user}}:")],
    };

    for await (const chunk of llama(prompt, llamaParams, {
        controller: controller.value,
    })) {
        const data = chunk.data;
        currentMessage += data.content;

        // remove leading whitespace
        currentMessage = currentMessage.replace(/^\s+/, "");

        transcriptUpdate([...history, ["{{char}}", currentMessage]]);

        if (data.stop) {
            console.log(
                "Completion finished: '",
                currentMessage,
                "', summary: ",
                data
            );
        }

        if (data.timings) {
            llamaStats.value = data.timings;
        }
    }

    controller.value = null;
};

function MessageInput() {
    const message = useSignal("");

    const stop = (e) => {
        e.preventDefault();
        if (controller.value) {
            controller.value.abort();
            controller.value = null;
        }
    };

    const reset = (e) => {
        stop(e);
        transcriptUpdate([]);
    };

    const submit = (e) => {
        stop(e);
        chat(message.value);
        message.value = "";
    };

    const enterSubmits = (event) => {
        if (event.which === 13 && !event.shiftKey) {
            submit(event);
        }
    };

    return html`
        <form onsubmit=${submit}>
            <div>
                <textarea
                    type="text"
                    rows="2"
                    onkeypress=${enterSubmits}
                    value="${message}"
                    oninput=${(e) => (message.value = e.target.value)}
                    placeholder="Say something..."
                />
            </div>
            <div class="right">
                <button type="submit" disabled=${!generating.value}>
                    Send
                </button>
                <button onclick=${stop} disabled=${generating}>Stop</button>
                <button onclick=${reset}>Reset</button>
            </div>
        </form>
    `;
}

const ChatLog = (props) => {
    const messages = session.value.transcript;
    const container = useRef(null);

    useEffect(() => {
        // scroll to bottom (if needed)
        if (
            container.current &&
            container.current.scrollHeight <=
                container.current.scrollTop +
                    container.current.offsetHeight +
                    300
        ) {
            container.current.scrollTo(0, container.current.scrollHeight);
        }
    }, [messages]);

    const chatLine = ([user, msg]) => {
        return html`<p key=${msg}>
            <strong>${template(user)}: </strong>
            <${Markdownish} text=${template(msg)} />
        </p>`;
    };

    return html` <section id="chat" ref=${container}>
        ${messages.flatMap(chatLine)}
    </section>`;
};

const ConfigForm = (props) => {
    const updateSession = (el) =>
        (session.value = {
            ...session.value,
            [el.target.name]: el.target.value,
        });
    const updateParamsFloat = (el) =>
        (params.value = {
            ...params.value,
            [el.target.name]: parseFloat(el.target.value),
        });
    const updateParamsInt = (el) =>
        (params.value = {
            ...params.value,
            [el.target.name]: Math.floor(parseFloat(el.target.value)),
        });

    const FloatField = ({ label, max, min, name, step, value }) => {
        return html`
            <div>
                <label for="${name}">${label}</label>
                <input
                    type="range"
                    id="${name}"
                    min="${min}"
                    max="${max}"
                    step="${step}"
                    name="${name}"
                    value="${value}"
                    oninput=${updateParamsFloat}
                />
                <span>${value}</span>
            </div>
        `;
    };

    const IntField = ({ label, max, min, name, value }) => {
        return html`
            <div>
                <label for="${name}">${label}</label>
                <input
                    type="range"
                    id="${name}"
                    min="${min}"
                    max="${max}"
                    name="${name}"
                    value="${value}"
                    oninput=${updateParamsInt}
                />
                <span>${value}</span>
            </div>
        `;
    };

    return html`
        <form>
            <details>
                <summary>Settings</summary>
                <fieldset>
                    <div>
                        <label for="prompt">Prompt</label>
                        <textarea
                            type="text"
                            name="prompt"
                            value="${session.value.prompt}"
                            rows="4"
                            oninput=${updateSession}
                        />
                    </div>
                </fieldset>

                <fieldset class="two">
                    ${IntField({
                        label: "Predictions",
                        max: 2048,
                        min: -1,
                        name: "n_predict",
                        value: params.value.n_predict,
                    })}
                    ${FloatField({
                        label: "Temperature",
                        max: 1.5,
                        min: 0.0,
                        name: "temperature",
                        step: 0.01,
                        value: params.value.temperature,
                    })}
                    ${FloatField({
                        label: "Penalize repeat sequence",
                        max: 2.0,
                        min: 0.0,
                        name: "repeat_penalty",
                        step: 0.01,
                        value: params.value.repeat_penalty,
                    })}
                    ${IntField({
                        label: "Consider N tokens for penalize",
                        max: 2048,
                        min: 0,
                        name: "repeat_last_n",
                        value: params.value.repeat_last_n,
                    })}
                    ${IntField({
                        label: "Top-K sampling",
                        max: 100,
                        min: -1,
                        name: "top_k",
                        value: params.value.top_k,
                    })}
                    ${FloatField({
                        label: "Top-P sampling",
                        max: 1.0,
                        min: 0.0,
                        name: "top_p",
                        step: 0.01,
                        value: params.value.top_p,
                    })}
                </fieldset>
                <details>
                    <summary>More options</summary>
                    <fieldset class="two">
                        ${FloatField({
                            label: "TFS-Z",
                            max: 1.0,
                            min: 0.0,
                            name: "tfs_z",
                            step: 0.01,
                            value: params.value.tfs_z,
                        })}
                        ${FloatField({
                            label: "Typical P",
                            max: 1.0,
                            min: 0.0,
                            name: "typical_p",
                            step: 0.01,
                            value: params.value.typical_p,
                        })}
                        ${FloatField({
                            label: "Presence penalty",
                            max: 1.0,
                            min: 0.0,
                            name: "presence_penalty",
                            step: 0.01,
                            value: params.value.presence_penalty,
                        })}
                        ${FloatField({
                            label: "Frequency penalty",
                            max: 1.0,
                            min: 0.0,
                            name: "frequency_penalty",
                            step: 0.01,
                            value: params.value.frequency_penalty,
                        })}
                    </fieldset>
                    <hr />
                    <fieldset class="three">
                        <div>
                            <label
                                ><input
                                    type="radio"
                                    name="mirostat"
                                    value="0"
                                    checked=${params.value.mirostat == 0}
                                    oninput=${updateParamsInt}
                                />
                                no Mirostat</label
                            >
                            <label
                                ><input
                                    type="radio"
                                    name="mirostat"
                                    value="1"
                                    checked=${params.value.mirostat == 1}
                                    oninput=${updateParamsInt}
                                />
                                Mirostat v1</label
                            >
                            <label
                                ><input
                                    type="radio"
                                    name="mirostat"
                                    value="2"
                                    checked=${params.value.mirostat == 2}
                                    oninput=${updateParamsInt}
                                />
                                Mirostat v2</label
                            >
                        </div>
                        ${FloatField({
                            label: "Mirostat tau",
                            max: 10.0,
                            min: 0.0,
                            name: "mirostat_tau",
                            step: 0.01,
                            value: params.value.mirostat_tau,
                        })}
                        ${FloatField({
                            label: "Mirostat eta",
                            max: 1.0,
                            min: 0.0,
                            name: "mirostat_eta",
                            step: 0.01,
                            value: params.value.mirostat_eta,
                        })}
                    </fieldset>
                </details>
            </details>
        </form>
    `;
};
// poor mans markdown replacement
const Markdownish = (params) => {
    const md = params.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/^#{1,6} (.*)$/gim, "<h3>$1</h3>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(.*?)__/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/_(.*?)_/g, "<em>$1</em>")
        .replace(/```.*?\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
        .replace(/`(.*?)`/g, "<code>$1</code>")
        .replace(/\n/gim, "<br />");
    return html`<span dangerouslySetInnerHTML=${{ __html: md }} />`;
};

const ModelGenerationInfo = (params) => {
    if (!llamaStats.value) {
        return html`<span />`;
    }
    return html`
        <span>
            ${llamaStats.value.predicted_per_token_ms.toFixed()}ms per token,
            ${llamaStats.value.predicted_per_second.toFixed(2)} tokens per
            second
        </span>
    `;
};

function App(props) {
    return html`
        <div id="container">
            <header>
                <h1>Ask Yoav</h1>
            </header>

            <main id="content">
                <${chatStarted.value ? ChatLog : ConfigForm} />
            </main>

            <section id="write">
                <${MessageInput} />
            </section>

            <footer>
                <p><${ModelGenerationInfo} /></p>
                <p>#I_LOVE_YOAV product</p>
                <p>Powerd by LLAMA2</p>
            </footer>
        </div>
    `;
}

render(h(App), document.body);
