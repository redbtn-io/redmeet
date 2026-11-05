

function LoadingPage({load}: any) {
    return (
        <div className={`loading-page ${load ? '' : 'hidden'} flex items-center justify-center w-full h-full bg-gray-100 fixed top-0 left-0 z-50`}>
            <div className="loading-page__content text-center">
                <div className="loading-page__spinner flex justify-center space-x-2">
                    <div className="loading-page__spinner__circle w-4 h-4 bg-[var(--primary-color)] rounded-full animate-bounce"></div>
                    <div className="loading-page__spinner__circle w-4 h-4 bg-[var(--primary-color)] rounded-full animate-bounce delay-150"></div>
                    <div className="loading-page__spinner__circle w-4 h-4 bg-[var(--primary-color)] rounded-full animate-bounce delay-300"></div>
                </div>
                <div className="loading-page__message mt-4 text-lg text-gray-700">{load}</div>
            </div>
        </div>  
    );
}

export default LoadingPage;