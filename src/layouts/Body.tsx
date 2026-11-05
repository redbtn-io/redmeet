

export default function BodyLayout({children}: any) {

    return <div className="md:flex space-x-4 space-y-2 md:rounded-md] p-4 md:p-6 pt-0 overflow-scroll h-[calc(100vh-12rem)] md:h-[calc(100vh-22rem)]" id="body">
        {children}
    </div>
}