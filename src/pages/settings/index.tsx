import { useEffect } from "react";
import BaseLayout from "../../layouts/Base";
import NavLayout from "../../layouts/Nav";
import { Link } from "react-router";
import HeroLayout from "../../layouts/Hero";



export default function Settings({ user }: any) {

    useEffect(() => {
        if (!user) window.location.href = '/';
    }, [user]);

    useEffect(() => {
        document.getElementById('root')!.style.setProperty('--primary-color', 'red')
    },[]);

    return <BaseLayout>
        <NavLayout>
            <h3>Settings</h3>
            {user && <h2><Link to='/'>{user.displayName}</Link></h2>}
        </NavLayout>
        <HeroLayout>
            <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto">
                <img src={user.photoURL} alt={user.displayName} className="w-16 h-16 rounded-full"/>
            </div>
            <br/>
            <div className={`mx-auto`}>
                    <p className="text-sm text-gray-600">{user.email}</p>
            </div>
        </HeroLayout>
        <BaseLayout>
            <div className="p-4">
                <h3>Settings</h3>
                <p>Coming soon...</p>
            </div>
        </BaseLayout>
    </BaseLayout>

}