import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useUser } from '../../hooks/user';
import BaseLayout from '../../layouts/Base';
import NavLayout from '../../layouts/Nav';
import HeroLayout from '../../layouts/Hero';
import BodyLayout from '../../layouts/Body';
import { Footer } from '../schedule';

export default function Booking() {

    const { user } = useParams();
    const {loading, userDetails} = useUser(user || "");
    const navigate = useNavigate();

    const lightenColor = (color: string, percent: number) => {
        const num = parseInt(color.replace("#", ""), 16),
            amt = Math.round(2.55 * percent),
            R = (num >> 16) + amt,
            G = (num >> 8 & 0x00FF) + amt,
            B = (num & 0x0000FF) + amt;
        return `#${(0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1)}`;
    };


    useEffect(() => {
        if (userDetails?.error) window.location.href = '/';
        const host = 'https://' + window.location.host;
        const website = window.location.host.split('.').slice(-2)[0];
        if (userDetails?.color) {
            const color = userDetails.origins[host].color || userDetails.color;
            document.getElementById('root')!.style.setProperty('--primary-color', color || 'red');
            const highlightColor = lightenColor(color || 'red', 20);
            document.documentElement.style.setProperty('--highlight-color', highlightColor);
        }

        if (userDetails?.origins && userDetails.origins[host]) {
            const logo = userDetails.origins[host].logo;
            if (logo) { 
                const link = document.createElement('link');
                link.rel = 'icon';
                link.href = logo;
                document.head.appendChild(link);
            }
        }
        document.title = `Meet with ${userDetails?.name || ''} - ${website}`;
    }, [userDetails]);

    return (<>
        <BaseLayout>
            <NavLayout>
                    { !loading && userDetails?.name && <h3> Meet with {userDetails.name}</h3> }
                    <p className="opacity-50 uppercase text-xs">Eastern Time</p>
            </NavLayout>

            <HeroLayout>
                <div className="w-16 h-16 bg-gray-200 rounded-full"></div>
                <br/>
                <div>
                    <p className="text-sm text-gray-600">This is a sample description about the user.</p>
                </div>
            </HeroLayout>
            

            <BodyLayout>
                <div className={`mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2`}>
                    {!loading && userDetails?.meetings && <>
                        {userDetails.meetings.map((meeting: any) => {
                            return (
                                <div key={meeting.id} className="p-4 border-t border-gray-300 shadow-b cursor-pointer hover:bg-gray-100 h-36 overflow-ellipsis">
                                    <div
                                        onClick={() => {
                                            navigate(`${meeting.link}`);
                                        }}
                                    >
                                        <h1 className="text-md font-semibold">{meeting.name}</h1>
                                        <p className="mt-2 text-sm">{meeting.description}</p>
                                    </div>
                                </div>
                            )
                        }
                        )}
                    </>}
                </div>
            </BodyLayout>
            <Footer/>
        </BaseLayout>
    </>)
}
