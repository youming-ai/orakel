import { useEffect, useState } from "react";

export function useCycleCountdown() {
	const [timeLeft, setTimeLeft] = useState("--:--");

	useEffect(() => {
		const update = () => {
			const now = new Date();
			const m = now.getMinutes();
			const s = now.getSeconds();
			const remainM = 14 - (m % 15);
			const remainS = 59 - s;
			setTimeLeft(`${String(remainM).padStart(2, "0")}:${String(remainS).padStart(2, "0")}`);
		};
		update();
		const timer = setInterval(update, 1000);
		return () => clearInterval(timer);
	}, []);

	return timeLeft;
}
