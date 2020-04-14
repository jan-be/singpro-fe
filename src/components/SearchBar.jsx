import React, { useState } from 'react';
import { apiDomain } from "../GlobalConsts";
import { TextField, Typography } from "@material-ui/core";
import { Link } from "react-router-dom";

const SearchBar = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [songSearchItemsToShow, setSongSearchItemsToShow] = useState([]);

  const handleSearchTermChange = async event => {
    let newTerm = event.target.value;
    setSearchTerm(newTerm);

    let resp = await fetch(`https://${apiDomain}/search/${newTerm}`)
    let jsonObj = await resp.json();

    setSongSearchItemsToShow(jsonObj.data);
  };

  return (
    <div>
      <TextField variant="outlined" value={searchTerm} onChange={handleSearchTermChange}/>
      {songSearchItemsToShow.map((e, i) => {
        let dashTitle = `${e.artist.replace(/[\W]+/g, "_")}--${e.title.replace(/[\W ]+/g, "_")}`;

        return (
          <div key={i}>
            <Typography component={Link} to={`/sing/${dashTitle}/${e.hash}`}>{e.artist} - {e.title}</Typography>
          </div>);
      })}
    </div>
  );
};

export default SearchBar;
