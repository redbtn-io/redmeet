import { useEffect, useState } from "react";
import { getLink, getUser } from "../calls/user";

export function useUser(user: string) {
  const [loading, setLoading] = useState<boolean>(true);
  const [userDetails, setUserDetails] = useState<any>(null);

  useEffect(() => {
    getUser(user).then((data) => {
      setUserDetails(data);
      setLoading(false);
    });
  }, [user]);

  return { loading, userDetails };
}