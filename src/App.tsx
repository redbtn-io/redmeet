import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { useAuthState } from 'react-firebase-hooks/auth';
import { Route, BrowserRouter as Router, Routes } from 'react-router';
import { useLink } from './hooks/link';
import Booking from './pages/booking';
import Scheduler from "./pages/calendar";
import Schedule from "./pages/schedule";
import Settings from './pages/settings';

const app = initializeApp({
    apiKey: "AIzaSyAnl336nVk_9DIuvSe61tJp8KL6MP3oAbI",
    authDomain: "georgeanthonycrm.firebaseapp.com",
    projectId: "georgeanthonycrm",
    storageBucket: "georgeanthonycrm.firebasestorage.app",
    messagingSenderId: "481589238305",
    appId: "1:481589238305:web:f0abe53002bb3f6b572160"
  });
const auth = getAuth(app);

export function App() {
    
    const [user, loading] = useAuthState(auth);


    
    
    if (loading) {
        return <div>Loading...</div>
    }

    const logOut = () => {
        signOut(auth)
        window.location.href = '/'
    }

    

    return (<Router>
        <Routes>
          <Route path="/">
            <Route index element={<Home {...{user}} />} />
            <Route path='/schedule' element={<Schedule {...{user, logOut}}/>} />
            <Route path='/settings' element={<Settings {...{user, logOut}}/>} />
            <Route path=":user">
              <Route index element={<Booking />} />
              <Route path=":meeting" element={<Scheduler />} />
            </Route>
          </Route>
        </Routes>
      </Router>
    );
}

function Home({user}: any) {
    const { loading: linkLoading, link } = useLink(user);
    const provider = new GoogleAuthProvider();
    if (!user) return <>
        <div className="flex flex-col items-center justify-center h-screen">
            <button onClick={async () => signInWithPopup(auth, provider)} className="p-4 bg-blue-500 text-white rounded cursor-pointer">Sign in with Google</button>
        </div>
    </>
    return <>
        {!linkLoading && <div className="flex flex-col items-center justify-center h-screen">
            <h1 className="text-4xl font-bold">Welcome {user.displayName}</h1><br/>
            <button onClick={() => window.location.href = `/${link}`} className="p-4 bg-blue-500 text-white rounded cursor-pointer">Booking Link</button><br/>
            <button onClick={() => window.location.href = '/schedule'} className="p-4 bg-blue-500 text-white rounded cursor-pointer">Schedule</button><br/>
            <button onClick={() => window.location.href = '/settings'} className="p-4 bg-gray-500 text-white rounded cursor-pointer">Settings</button><br/>
            <button onClick={() => signOut(auth)} className="p-4 bg-red-500 text-white rounded cursor-pointer">Sign Out</button>
        </div>}
    </>
}