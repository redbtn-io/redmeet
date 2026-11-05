
import '../index.css';

export default function LoadingWheel() {

    return (
        <div className="loading-page__spinner flex justify-center space-x-2 m-auto">
            <div className="loading-page__spinner__circle w-4 h-4 bg-[var(--primary-color)] rounded-full animate-bounce"></div>
            <div className="loading-page__spinner__circle w-4 h-4 bg-[var(--primary-color)] rounded-full animate-bounce delay-150"></div>
            <div className="loading-page__spinner__circle w-4 h-4 bg-[var(--primary-color)] rounded-full animate-bounce delay-300"></div>
        </div>
    );
}