import { useEffect, useState } from "react";
import { getLink } from "../calls/user";


export function useLink(user: any) {
  const [loading, setLoading] = useState<boolean>(true);
  const [link, setLink] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    getLink(user).then((data) => {
        setLink(data.link);
        setLoading(false);
    }).catch((error) => {
        setError(error);
        setLoading(false);
    });
  }, [user]);

  return { loading, link, error };
}