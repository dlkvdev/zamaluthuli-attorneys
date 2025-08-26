const { createRoot } = ReactDOM;
const { default: App } = await import('/src/components/App.jsx');
const root = createRoot(document.getElementById('root'));
root.render(<App />);