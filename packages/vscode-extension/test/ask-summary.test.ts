import { describe, expect, it } from "bun:test";
import { askSummary } from "../webview/chat/ask-summary";

const questions = [
	{
		id: "db",
		header: "Base de datos",
		question: "¿Qué motor?",
		options: [{ label: "PostgreSQL", description: "Igual que prod" }, { label: "MySQL" }],
	},
	{ id: "env", question: "¿Entornos?", multi: true, options: [{ label: "dev" }, { label: "prod" }] },
];

describe("askSummary", () => {
	it("marks each question's answers from the results of a multi-question ask, by id", () => {
		const details = {
			results: [
				{ id: "env", selectedOptions: [], customInput: " también QA ", note: "sin prisa" },
				{ id: "db", selectedOptions: ["MySQL"] },
			],
		};
		expect(askSummary({ questions }, details)).toEqual([
			{
				header: "Base de datos",
				question: "¿Qué motor?",
				multi: false,
				options: [
					{ label: "PostgreSQL", description: "Igual que prod", chosen: false },
					{ label: "MySQL", chosen: true },
				],
				timedOut: false,
				answered: true,
			},
			{
				question: "¿Entornos?",
				multi: true,
				options: [
					{ label: "dev", chosen: false },
					{ label: "prod", chosen: false },
				],
				custom: "también QA",
				note: "sin prisa",
				timedOut: false,
				answered: true,
			},
		]);
	});

	it("reads the flat details of a single-question ask, including a timeout", () => {
		const [item] = askSummary({ questions: [questions[0]] }, { selectedOptions: ["PostgreSQL"], timedOut: true });
		expect(item?.options.map(option => option.chosen)).toEqual([true, false]);
		expect(item?.timedOut).toBe(true);
	});

	it("leaves every question unanswered without details (waiting or dismissed)", () => {
		expect(askSummary({ questions }, undefined).map(item => item.answered)).toEqual([false, false]);
	});
});
