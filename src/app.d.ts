declare global {
	const __APP_VERSION__: string;
	/** The git commit the app was built from, '' when unknown. */
	const __APP_COMMIT__: string;
	namespace App {}
}

export {};
