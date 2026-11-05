
function ResultMessage({results, setResults}:any) {
    return (
        <div className={`loading-page ${results ? '' : 'hidden'} flex items-center justify-center w-full h-full bg-gray-100 fixed top-0 left-0 z-50`}>
            <div className="loading-page__content text-center relative">
                <div className="loading-page__message mt-4 text-lg text-gray-700">{results}</div>
                <button 
                    onClick={() => setResults(false)} 
                    className="mt-4 px-4 py-2 bg-[var(--primary-color)] text-white rounded hover:bg-[var(--highlight-color)] cursor-pointer"
                >
                    Close
                </button>
            </div>
        </div>
    );
}

export default ResultMessage;