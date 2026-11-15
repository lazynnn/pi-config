import {
    DynamicBorder,
    type AgentEndEvent,
    type ExtensionAPI,
    type ExtensionContext,
    type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { Text, Container } from "@earendil-works/pi-tui";
import * as asciichart from "asciichart";

interface TpsRecord {
    idx: number;
    tps: number;
    outputTokens: number;
    seconds: number;
}

export default function(pi: ExtensionAPI) {
    const EXTENSION_TYPE: string = "lazy.pi.tps.tracker";
    const MAX_WINDOW_SIZE: number = 30;
    const tpsHistory: TpsRecord[] = [];
    let counter: number = 1;
    let turnStart: number | null = null;

    pi.on(
        "session_start",
        (_event: SessionStartEvent, _ctx: ExtensionContext) => {
            try {
                const entries = _ctx.sessionManager
                    .getEntries()
                    .slice(-MAX_WINDOW_SIZE);
                for (const entry of entries) {
                    // Look for our custom entry type
                    if (
                        entry.type === "custom" &&
                        entry.customType === EXTENSION_TYPE &&
                        entry.data
                    ) {
                        const data = entry.data as TpsRecord;
                        tpsHistory.push({
                            idx: data.idx,
                            tps: data.tps,
                            outputTokens: data.outputTokens,
                            seconds: data.seconds,
                        });
                        ++counter;
                    }
                }

                if (_ctx.hasUI && tpsHistory.length > 0) {
                    _ctx.ui.setStatus(
                        "tps",
                        `⚡${tpsHistory.at(-1)?.tps.toFixed(1)} tok/s`,
                    );
                }
            } catch {
                // ignore
            }
        },
    );

    // start of generation
    pi.on("agent_start", () => {
        turnStart = Date.now();
    });

    // end of generation
    pi.on("agent_end", (_event: AgentEndEvent, _ctx: ExtensionContext) => {
        if (turnStart === null) {
            return;
        }
        const elapsedSeconds = (Date.now() - turnStart) / 1000;
        turnStart = null;
        if (elapsedSeconds <= 0) {
            return;
        }

        let outputTokens = 0;
        for (let msg of _event.messages) {
            // @ts-ignore
            outputTokens += msg?.usage?.output || 0;
        }

        if (outputTokens <= 0) {
            return;
        }

        const tps = outputTokens / elapsedSeconds;
        if (tpsHistory.length >= MAX_WINDOW_SIZE) {
            tpsHistory.shift();
        }
        tpsHistory.push({
            idx: counter++,
            tps: tps,
            outputTokens: outputTokens,
            seconds: elapsedSeconds,
        });
        pi.appendEntry(EXTENSION_TYPE, tpsHistory.at(-1));

        if (_ctx.hasUI) {
            _ctx.ui.setStatus("tps", `⚡${tps.toFixed(1)} tok/s`);
        }
    });

    // Register /tps command using asciichart
    pi.registerCommand("tps", {
        description: "Show recent token/s trend line chart for this session",
        handler: async (_args, _ctx) => {
            if (!_ctx.hasUI) {
                console.log(
                    `Last turn: ${tpsHistory.length > 0 ? `${tpsHistory.at(-1)?.tps.toFixed(1)} tok/s` : "No turns yet"}`,
                );
                return;
            }

            if (tpsHistory.length === 0) {
                _ctx.ui.notify(
                    "No generation speed data recorded yet in this session.",
                    "info",
                );
                return;
            }

            const tpsValues = tpsHistory.map((r) => r.tps);
            // Render true ASCII line chart with asciichart
            const chartString = asciichart.plot(tpsValues, {
                height: 6,
                padding: "      ",
                format: (x: number) => x.toFixed(1).padStart(6, " "),
            });

            const avgTps =
                tpsHistory.reduce((a, b) => a + b.tps, 0) / tpsHistory.length;
            const lastRecord = tpsHistory.at(-1)!;

            const reportLines = [
                `📊 Session TPS Trend (Tokens / Second)`,
                `Last Turn (#${lastRecord.idx}): ${lastRecord.tps.toFixed(1)} tok/s (${lastRecord.outputTokens} tokens in ${lastRecord.seconds.toFixed(1)}s)`,
                `Session Avg:     ${avgTps.toFixed(1)} tok/s`,
                ``,
                ...chartString.split("\n"),
                ``,
                `Press Enter, Esc, or q to close.`,
            ];

            await _ctx.ui.custom((_tui, _theme, _kb, done) => {
                let container = new Container();
                container.addChild(
                    new DynamicBorder((str) => _theme.fg("border", str)),
                );
                container.addChild(new Text(reportLines.join("\n"), 1, 1));
                container.addChild(
                    new DynamicBorder((str) => _theme.fg("border", str)),
                );
                return {
                    render: (_width) => container.render(_width),
                    handleInput: (data: string) => {
                        if (
                            data === "\r" ||
                            data === "\n" ||
                            data === "\x1b" ||
                            data === "q"
                        ) {
                            done(undefined);
                        }
                    },
                    invalidate: () => { },
                };
            });
        },
    });
}
