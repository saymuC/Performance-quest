import express from "express";

const router = express.Router();

router.get("/", async (req, res) => {
    res.json({
        message: "Rota de questões ta zero bala tropa"
    });
});

export default router;