

export default function NavLayout({children}: any) {
    
    return <div className="p-4 border text-white shadow-xl bg-[var(--primary-color)] border-[var(--primary-color)] md:rounded-t-lg fixed w-full lg:max-w-4xl">
        <div className="flex justify-between items-center">
            {children}
        </div>
    </div>
}