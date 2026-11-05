
export default function BaseLayout({children}: any) {

    return <div className={`flex flex-col mx-auto bg-white space-y-4 lg:max-w-4xl md:shadow-xl md:my-16 md:rounded-lg border-gray-500 h-full`}>
        {children}
    </div>
}